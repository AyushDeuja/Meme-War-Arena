use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

pub mod math;

declare_id!("FZACcydNJBwxXUGYB1u5tRFWtmriR97PuBTYnPVskAWs");

pub const MAX_PLAYERS: usize = 10;
pub const MAX_TEAM_PLAYERS: usize = 5;
pub const ROUND_SECONDS: i64 = 90;
pub const STARTING_CREDITS: u64 = 1_000;
pub const INITIAL_CREDIT_RESERVE: u64 = 10_000;
pub const INITIAL_SHARE_RESERVE: u64 = 1_000 * math::SHARE_SCALE;

#[ephemeral]
#[program]
pub mod meme_wars {
    use super::*;

    /// Create the durable match account on Solana before delegation.
    pub fn initialize_match(
        ctx: Context<InitializeMatch>,
        match_id: u64,
        verifier: Pubkey,
    ) -> Result<()> {
        require!(verifier != Pubkey::default(), GameError::InvalidVerifier);
        let game = &mut ctx.accounts.game;
        game.authority = ctx.accounts.authority.key();
        game.verifier = verifier;
        game.match_id = match_id;
        game.status = MatchStatus::Scheduled as u8;
        game.outcome = MatchOutcome::Pending as u8;
        game.credit_reserves = [INITIAL_CREDIT_RESERVE; 2];
        game.share_reserves = [INITIAL_SHARE_RESERVE; 2];
        game.bump = ctx.bumps.game;
        Ok(())
    }

    /// The authority delegates the single writable match account on the base layer.
    pub fn delegate_match(ctx: Context<DelegateMatch>, match_id: u64) -> Result<()> {
        let id = match_id.to_le_bytes();
        ctx.accounts.delegate_pda(
            &ctx.accounts.authority,
            &[b"match", ctx.accounts.authority.key.as_ref(), &id],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|account| account.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Run on the ER. Every wallet can claim the round allowance only once.
    pub fn join_match(ctx: Context<MutateMatch>) -> Result<()> {
        ctx.accounts
            .game
            .join(ctx.accounts.player.key(), Clock::get()?.unix_timestamp)
    }

    /// Reserve one of five scoring slots for a registered wallet on the ER.
    pub fn choose_team(ctx: Context<MutateMatch>, team: u8) -> Result<()> {
        ctx.accounts.game.choose_team(
            ctx.accounts.player.key(),
            team,
            Clock::get()?.unix_timestamp,
        )
    }

    /// Start the 90-second round on the ER after players have joined.
    pub fn start_match(ctx: Context<AuthorityMatch>) -> Result<()> {
        ctx.accounts.game.start(Clock::get()?.unix_timestamp)
    }

    /// Anyone may close an expired round; its outcome remains pending.
    pub fn close_match(ctx: Context<CloseMatch>) -> Result<()> {
        ctx.accounts.game.close_round(Clock::get()?.unix_timestamp)
    }

    /// Persist the current delegated state to Solana. Call on the ER.
    pub fn commit_match(ctx: Context<SettleMatch>) -> Result<()> {
        ctx.accounts.game.require_commit_ready()?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.game.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Return ownership to this program and settle final state. Call on the ER.
    pub fn undelegate_match(ctx: Context<SettleMatch>) -> Result<()> {
        ctx.accounts.game.require_undelegate_ready()?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.game.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(match_id: u64, verifier: Pubkey)]
pub struct InitializeMatch<'info> {
    #[account(init, payer = authority, space = 8 + Match::LEN, seeds = [b"match", authority.key().as_ref(), &match_id.to_le_bytes()], bump)]
    pub game: Account<'info, Match>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct DelegateMatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: The seeds bind this PDA to the authority and match ID; the SDK validates delegation.
    #[account(mut, del, seeds = [b"match", authority.key().as_ref(), &match_id.to_le_bytes()], bump)]
    pub pda: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MutateMatch<'info> {
    #[account(mut, seeds = [b"match", game.authority.as_ref(), &game.match_id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, Match>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct AuthorityMatch<'info> {
    #[account(mut, has_one = authority, seeds = [b"match", game.authority.as_ref(), &game.match_id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, Match>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseMatch<'info> {
    #[account(mut, seeds = [b"match", game.authority.as_ref(), &game.match_id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, Match>,
    pub caller: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct SettleMatch<'info> {
    #[account(mut, has_one = authority, seeds = [b"match", game.authority.as_ref(), &game.match_id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, Match>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[account]
pub struct Match {
    pub authority: Pubkey,
    pub verifier: Pubkey,
    pub match_id: u64,
    pub status: u8,
    pub outcome: u8,
    pub started_at: i64,
    pub ends_at: i64,
    pub finalized_at: i64,
    pub credit_reserves: [u64; 2],
    pub share_reserves: [u64; 2],
    pub team_scores: [u64; 2],
    pub players: [PlayerSlot; MAX_PLAYERS],
    pub player_count: u8,
    pub bump: u8,
}

impl Match {
    pub const LEN: usize =
        32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 16 + 16 + 16 + PlayerSlot::LEN * MAX_PLAYERS + 1 + 1;

    fn active_players(&self) -> Result<&[PlayerSlot]> {
        self.players
            .get(..usize::from(self.player_count))
            .ok_or_else(|| error!(GameError::InvalidStatus))
    }

    fn require_registration_open(&self, now: i64) -> Result<()> {
        match self.status {
            status if status == MatchStatus::Scheduled as u8 => Ok(()),
            status if status == MatchStatus::Live as u8 && now < self.ends_at => Ok(()),
            _ => err!(GameError::Closed),
        }
    }

    pub fn join(&mut self, wallet: Pubkey, now: i64) -> Result<()> {
        self.require_registration_open(now)?;
        require!(
            !self
                .active_players()?
                .iter()
                .any(|entry| entry.wallet == wallet),
            GameError::AlreadyJoined
        );
        let index = usize::from(self.player_count);
        require!(index < MAX_PLAYERS, GameError::Full);
        self.players[index] = PlayerSlot {
            wallet,
            credits: STARTING_CREDITS,
            ..PlayerSlot::default()
        };
        self.player_count = self
            .player_count
            .checked_add(1)
            .ok_or(GameError::Overflow)?;
        Ok(())
    }

    pub fn choose_team(&mut self, wallet: Pubkey, team: u8, now: i64) -> Result<()> {
        self.require_registration_open(now)?;
        require!(
            team == Team::Frog as u8 || team == Team::Cat as u8,
            GameError::InvalidTeam
        );
        let index = self
            .active_players()?
            .iter()
            .position(|entry| entry.wallet == wallet)
            .ok_or(GameError::NotRegistered)?;
        require!(self.players[index].team == 0, GameError::TeamAlreadyChosen);
        let count = self
            .active_players()?
            .iter()
            .filter(|entry| entry.team == team)
            .count();
        require!(count < MAX_TEAM_PLAYERS, GameError::TeamFull);
        self.players[index].team = team;
        Ok(())
    }

    pub fn start(&mut self, now: i64) -> Result<()> {
        require!(
            self.status == MatchStatus::Scheduled as u8,
            GameError::InvalidStatus
        );
        let players = self.active_players()?;
        require!(
            players.iter().any(|entry| entry.team == Team::Frog as u8)
                && players.iter().any(|entry| entry.team == Team::Cat as u8),
            GameError::TeamsMissing
        );
        let ends_at = now.checked_add(ROUND_SECONDS).ok_or(GameError::Overflow)?;
        self.started_at = now;
        self.ends_at = ends_at;
        self.status = MatchStatus::Live as u8;
        Ok(())
    }

    pub fn close_round(&mut self, now: i64) -> Result<()> {
        require!(
            self.status == MatchStatus::Live as u8,
            GameError::InvalidStatus
        );
        require!(now >= self.ends_at, GameError::TooEarly);
        self.status = MatchStatus::Finalizing as u8;
        Ok(())
    }

    pub fn require_commit_ready(&self) -> Result<()> {
        require!(
            self.status == MatchStatus::Live as u8 || self.status == MatchStatus::Finalizing as u8,
            GameError::InvalidStatus
        );
        Ok(())
    }

    pub fn require_undelegate_ready(&self) -> Result<()> {
        require!(
            self.status == MatchStatus::Finalizing as u8,
            GameError::InvalidStatus
        );
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct PlayerSlot {
    pub wallet: Pubkey,
    pub credits: u64,
    pub frog_shares: u64,
    pub cat_shares: u64,
    pub team: u8,
    pub best_score: u16,
    pub attempts_used: u8,
}

impl PlayerSlot {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 1 + 2 + 1;
}

#[repr(u8)]
pub enum MatchStatus {
    Scheduled = 0,
    Live = 1,
    Finalizing = 2,
    Finalized = 3,
}

#[repr(u8)]
pub enum Team {
    Frog = 1,
    Cat = 2,
}

#[repr(u8)]
pub enum MatchOutcome {
    Pending = 0,
    Frog = 1,
    Cat = 2,
    Draw = 3,
}

#[error_code]
pub enum GameError {
    #[msg("The match is closed")]
    Closed,
    #[msg("This wallet already joined")]
    AlreadyJoined,
    #[msg("The match is full")]
    Full,
    #[msg("The match is in the wrong state")]
    InvalidStatus,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("The verifier public key is invalid")]
    InvalidVerifier,
    #[msg("The player has not joined this match")]
    NotRegistered,
    #[msg("Choose Frog or Cat")]
    InvalidTeam,
    #[msg("The player already chose a team")]
    TeamAlreadyChosen,
    #[msg("This team's roster is full")]
    TeamFull,
    #[msg("Both teams need a player before the match starts")]
    TeamsMissing,
    #[msg("The match deadline has not arrived")]
    TooEarly,
}

#[cfg(test)]
mod baseline_tests {
    use super::*;

    fn empty_match() -> Match {
        Match {
            authority: Pubkey::new_unique(),
            verifier: Pubkey::new_unique(),
            match_id: 7,
            status: MatchStatus::Scheduled as u8,
            outcome: MatchOutcome::Pending as u8,
            started_at: 0,
            ends_at: 0,
            finalized_at: 0,
            credit_reserves: [INITIAL_CREDIT_RESERVE; 2],
            share_reserves: [INITIAL_SHARE_RESERVE; 2],
            team_scores: [0; 2],
            players: [PlayerSlot::default(); MAX_PLAYERS],
            player_count: 0,
            bump: 254,
        }
    }

    #[test]
    fn match_account_fits_declared_allocation_and_round_trips() {
        let authority = Pubkey::new_unique();
        let verifier = Pubkey::new_unique();
        let mut players = [PlayerSlot::default(); MAX_PLAYERS];
        for (index, player) in players.iter_mut().enumerate() {
            player.wallet = Pubkey::new_unique();
            player.credits = STARTING_CREDITS;
            player.team = if index < 5 { 1 } else { 2 };
        }
        let game = Match {
            authority,
            verifier,
            match_id: 7,
            status: MatchStatus::Scheduled as u8,
            outcome: MatchOutcome::Pending as u8,
            started_at: 0,
            ends_at: 0,
            finalized_at: 0,
            credit_reserves: [INITIAL_CREDIT_RESERVE; 2],
            share_reserves: [INITIAL_SHARE_RESERVE; 2],
            team_scores: [0; 2],
            players,
            player_count: MAX_PLAYERS as u8,
            bump: 254,
        };

        let mut encoded = Vec::new();
        game.try_serialize(&mut encoded).unwrap();
        assert_eq!(Match::LEN, 748);
        assert_eq!(encoded.len(), 8 + Match::LEN);
        assert!(encoded.len() <= 10_240);

        let decoded = Match::try_deserialize(&mut encoded.as_slice()).unwrap();
        assert_eq!(decoded.authority, authority);
        assert_eq!(decoded.verifier, verifier);
        assert_eq!(decoded.match_id, 7);
        assert_eq!(decoded.credit_reserves, [INITIAL_CREDIT_RESERVE; 2]);
        assert_eq!(decoded.share_reserves, [INITIAL_SHARE_RESERVE; 2]);
        assert_eq!(decoded.player_count, MAX_PLAYERS as u8);
        assert_eq!(decoded.players[9].team, 2);
    }

    #[test]
    fn a_wallet_receives_credits_once_and_capacity_is_ten() {
        let mut game = empty_match();
        let first = Pubkey::new_unique();
        game.join(first, 10).unwrap();
        assert_eq!(game.players[0].credits, STARTING_CREDITS);
        assert!(game.join(first, 10).is_err());
        assert_eq!(game.player_count, 1);
        assert_eq!(game.players[0].credits, STARTING_CREDITS);

        for _ in 1..MAX_PLAYERS {
            game.join(Pubkey::new_unique(), 10).unwrap();
        }
        assert_eq!(game.player_count, MAX_PLAYERS as u8);
        assert!(game.join(Pubkey::new_unique(), 10).is_err());
        assert_eq!(game.player_count, MAX_PLAYERS as u8);
    }

    #[test]
    fn team_choice_is_registered_permanent_and_capped_at_five() {
        let mut game = empty_match();
        let outsider = Pubkey::new_unique();
        assert!(game.choose_team(outsider, Team::Frog as u8, 10).is_err());
        assert!(game.choose_team(outsider, 0, 10).is_err());

        let wallets: Vec<_> = (0..6).map(|_| Pubkey::new_unique()).collect();
        for wallet in &wallets {
            game.join(*wallet, 10).unwrap();
        }
        assert!(game.choose_team(wallets[0], 3, 10).is_err());
        for wallet in &wallets[..5] {
            game.choose_team(*wallet, Team::Frog as u8, 10).unwrap();
        }
        assert!(game.choose_team(wallets[0], Team::Cat as u8, 10).is_err());
        assert!(game.choose_team(wallets[5], Team::Frog as u8, 10).is_err());
        assert_eq!(game.players[5].team, 0);
        game.choose_team(wallets[5], Team::Cat as u8, 10).unwrap();
        assert_eq!(game.players[5].team, Team::Cat as u8);
    }

    #[test]
    fn round_starts_with_both_teams_and_closes_at_exact_deadline() {
        let mut game = empty_match();
        let frog = Pubkey::new_unique();
        let cat = Pubkey::new_unique();
        assert!(game.start(100).is_err());
        game.join(frog, 100).unwrap();
        game.choose_team(frog, Team::Frog as u8, 100).unwrap();
        assert!(game.start(100).is_err());
        game.join(cat, 100).unwrap();
        game.choose_team(cat, Team::Cat as u8, 100).unwrap();
        game.start(100).unwrap();
        assert_eq!(game.started_at, 100);
        assert_eq!(game.ends_at, 190);
        assert!(game.start(101).is_err());
        assert!(game.close_round(189).is_err());

        let late_wallet = Pubkey::new_unique();
        game.join(late_wallet, 189).unwrap();
        assert!(game
            .choose_team(late_wallet, Team::Frog as u8, 190)
            .is_err());
        assert!(game.join(Pubkey::new_unique(), 190).is_err());
        game.close_round(190).unwrap();
        assert_eq!(game.status, MatchStatus::Finalizing as u8);
        assert_eq!(game.outcome, MatchOutcome::Pending as u8);
        assert_eq!(game.finalized_at, 0);
        assert!(game.close_round(191).is_err());
        assert!(game.join(Pubkey::new_unique(), 191).is_err());
    }

    #[test]
    fn settlement_requires_the_right_lifecycle_stage() {
        let mut game = empty_match();
        assert!(game.require_commit_ready().is_err());
        assert!(game.require_undelegate_ready().is_err());
        let frog = Pubkey::new_unique();
        let cat = Pubkey::new_unique();
        game.join(frog, 0).unwrap();
        game.join(cat, 0).unwrap();
        game.choose_team(frog, Team::Frog as u8, 0).unwrap();
        game.choose_team(cat, Team::Cat as u8, 0).unwrap();
        assert!(game.start(i64::MAX - ROUND_SECONDS + 1).is_err());
        assert_eq!(game.status, MatchStatus::Scheduled as u8);
        game.start(0).unwrap();
        game.require_commit_ready().unwrap();
        assert!(game.require_undelegate_ready().is_err());
        game.close_round(90).unwrap();
        game.require_commit_ready().unwrap();
        game.require_undelegate_ready().unwrap();
    }
}
