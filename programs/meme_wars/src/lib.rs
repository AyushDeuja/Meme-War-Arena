use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use std::str::FromStr;

pub mod math;

declare_id!("FZACcydNJBwxXUGYB1u5tRFWtmriR97PuBTYnPVskAWs");

pub const MAX_PLAYERS: usize = 10;
pub const MAX_TEAM_PLAYERS: usize = 5;
pub const ROUND_SECONDS: i64 = 90;
pub const STARTING_CREDITS: u64 = 1_000;
pub const INITIAL_CREDIT_RESERVE: u64 = 10_000;
pub const INITIAL_SHARE_RESERVE: u64 = 1_000 * math::SHARE_SCALE;
pub const MAX_BUY_CREDITS: u64 = 250;
pub const MIN_SELL_SHARES: u64 = math::SHARE_SCALE;
pub const MAX_SELL_SHARES: u64 = 100 * math::SHARE_SCALE;
pub const APPROVED_ORGANIZER: &str = "7QKBd6PsJ8qsybo5BEA41gh8sPp6YhMBteRdteVyiSgm";
pub const MAX_ATTEMPTS: u8 = 3;

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
        require_keys_eq!(
            ctx.accounts.authority.key(),
            Pubkey::from_str(APPROVED_ORGANIZER)
                .map_err(|_| error!(GameError::InvalidOrganizer))?,
            GameError::InvalidOrganizer
        );
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

    /// Exchange virtual credits for shares in one of the two independent pools.
    pub fn buy_shares(
        ctx: Context<MutateMatch>,
        pool: u8,
        credits_in: u64,
        min_shares_out: u64,
        expected_nonce: u64,
    ) -> Result<()> {
        ctx.accounts.game.buy_shares(
            ctx.accounts.player.key(),
            pool,
            credits_in,
            min_shares_out,
            expected_nonce,
            Clock::get()?.unix_timestamp,
        )
    }

    /// Exchange owned virtual shares for credits in the selected pool.
    pub fn sell_shares(
        ctx: Context<MutateMatch>,
        pool: u8,
        shares_in: u64,
        min_credits_out: u64,
        expected_nonce: u64,
    ) -> Result<()> {
        ctx.accounts.game.sell_shares(
            ctx.accounts.player.key(),
            pool,
            shares_in,
            min_credits_out,
            expected_nonce,
            Clock::get()?.unix_timestamp,
        )
    }

    /// Apply a server-measured result signed by both the player and approved verifier.
    pub fn submit_verified_attempt(
        ctx: Context<ScoreMatch>,
        attempt_index: u8,
        challenge_nonce: u64,
        score: u16,
        expires_at: i64,
    ) -> Result<()> {
        ctx.accounts.game.apply_verified_attempt(
            ctx.accounts.player.key(),
            attempt_index,
            challenge_nonce,
            score,
            expires_at,
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
pub struct ScoreMatch<'info> {
    #[account(mut, has_one = verifier, seeds = [b"match", game.authority.as_ref(), &game.match_id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, Match>,
    pub player: Signer<'info>,
    pub verifier: Signer<'info>,
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

    fn require_trade_open(&self, now: i64) -> Result<()> {
        require!(
            self.status == MatchStatus::Live as u8 && now < self.ends_at,
            GameError::Closed
        );
        Ok(())
    }

    fn player_index(&self, wallet: Pubkey) -> Result<usize> {
        self.active_players()?
            .iter()
            .position(|entry| entry.wallet == wallet)
            .ok_or_else(|| error!(GameError::NotRegistered))
    }

    fn pool_index(pool: u8) -> Result<usize> {
        require!(pool < 2, GameError::InvalidPool);
        Ok(usize::from(pool))
    }

    pub fn buy_shares(
        &mut self,
        wallet: Pubkey,
        pool: u8,
        credits_in: u64,
        min_shares_out: u64,
        expected_nonce: u64,
        now: i64,
    ) -> Result<()> {
        self.require_trade_open(now)?;
        let pool_index = Self::pool_index(pool)?;
        require!(
            (1..=MAX_BUY_CREDITS).contains(&credits_in) && min_shares_out > 0,
            GameError::InvalidTradeAmount
        );
        let player_index = self.player_index(wallet)?;
        let player = &self.players[player_index];
        require!(
            player.trade_nonce == expected_nonce,
            GameError::InvalidNonce
        );
        require!(player.credits >= credits_in, GameError::InsufficientCredits);
        let quote = math::quote_buy(
            self.credit_reserves[pool_index],
            self.share_reserves[pool_index],
            credits_in,
        )
        .map_err(trade_math_error)?;
        require!(
            quote.shares_out >= min_shares_out,
            GameError::SlippageExceeded
        );
        let credits = player
            .credits
            .checked_sub(credits_in)
            .ok_or(GameError::Overflow)?;
        let shares = player_shares(player, pool_index)
            .checked_add(quote.shares_out)
            .ok_or(GameError::Overflow)?;
        let nonce = player
            .trade_nonce
            .checked_add(1)
            .ok_or(GameError::Overflow)?;
        self.credit_reserves[pool_index] = quote.new_credit_reserve;
        self.share_reserves[pool_index] = quote.new_share_reserve;
        let player = &mut self.players[player_index];
        player.credits = credits;
        *player_shares_mut(player, pool_index) = shares;
        player.trade_nonce = nonce;
        Ok(())
    }

    pub fn sell_shares(
        &mut self,
        wallet: Pubkey,
        pool: u8,
        shares_in: u64,
        min_credits_out: u64,
        expected_nonce: u64,
        now: i64,
    ) -> Result<()> {
        self.require_trade_open(now)?;
        let pool_index = Self::pool_index(pool)?;
        require!(
            (MIN_SELL_SHARES..=MAX_SELL_SHARES).contains(&shares_in) && min_credits_out > 0,
            GameError::InvalidTradeAmount
        );
        let player_index = self.player_index(wallet)?;
        let player = &self.players[player_index];
        require!(
            player.trade_nonce == expected_nonce,
            GameError::InvalidNonce
        );
        require!(
            player_shares(player, pool_index) >= shares_in,
            GameError::InsufficientShares
        );
        let quote = math::quote_sell(
            self.credit_reserves[pool_index],
            self.share_reserves[pool_index],
            shares_in,
        )
        .map_err(trade_math_error)?;
        require!(
            quote.credits_out >= min_credits_out,
            GameError::SlippageExceeded
        );
        let credits = player
            .credits
            .checked_add(quote.credits_out)
            .ok_or(GameError::Overflow)?;
        let shares = player_shares(player, pool_index)
            .checked_sub(shares_in)
            .ok_or(GameError::Overflow)?;
        let nonce = player
            .trade_nonce
            .checked_add(1)
            .ok_or(GameError::Overflow)?;
        self.credit_reserves[pool_index] = quote.new_credit_reserve;
        self.share_reserves[pool_index] = quote.new_share_reserve;
        let player = &mut self.players[player_index];
        player.credits = credits;
        *player_shares_mut(player, pool_index) = shares;
        player.trade_nonce = nonce;
        Ok(())
    }

    pub fn apply_verified_attempt(
        &mut self,
        wallet: Pubkey,
        attempt_index: u8,
        challenge_nonce: u64,
        score: u16,
        expires_at: i64,
        now: i64,
    ) -> Result<()> {
        self.require_trade_open(now)?;
        require!(expires_at >= now, GameError::AttemptExpired);
        require!(matches!(score, 0 | 30 | 60 | 100), GameError::InvalidScore);
        require!(challenge_nonce != 0, GameError::InvalidChallengeNonce);
        let player_index = self.player_index(wallet)?;
        let player = &self.players[player_index];
        require!(
            player.team == 1 || player.team == 2,
            GameError::TeamNotChosen
        );
        require!(player.attempts_used < MAX_ATTEMPTS, GameError::AttemptLimit);
        let next_index = player
            .attempts_used
            .checked_add(1)
            .ok_or(GameError::Overflow)?;
        require!(attempt_index == next_index, GameError::InvalidAttemptIndex);
        require!(
            !player.used_challenge_nonces[..usize::from(player.attempts_used)]
                .contains(&challenge_nonce),
            GameError::InvalidChallengeNonce
        );
        let new_best = player.best_score.max(score);
        let score_delta = u64::from(new_best - player.best_score);
        let team_index = usize::from(player.team - 1);
        let new_team_score = self.team_scores[team_index]
            .checked_add(score_delta)
            .ok_or(GameError::Overflow)?;
        let perfect_attempts = if score == 100 {
            player
                .perfect_attempts
                .checked_add(1)
                .ok_or(GameError::Overflow)?
        } else {
            player.perfect_attempts
        };
        self.team_scores[team_index] = new_team_score;
        let player = &mut self.players[player_index];
        player.best_score = new_best;
        player.attempts_used = next_index;
        player.used_challenge_nonces[usize::from(attempt_index - 1)] = challenge_nonce;
        player.perfect_attempts = perfect_attempts;
        Ok(())
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
    pub trade_nonce: u64,
    pub used_challenge_nonces: [u64; 3],
    pub perfect_attempts: u8,
}

impl PlayerSlot {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 1 + 2 + 1 + 8 + 24 + 1;
}

fn player_shares(player: &PlayerSlot, pool_index: usize) -> u64 {
    if pool_index == 0 {
        player.frog_shares
    } else {
        player.cat_shares
    }
}

fn player_shares_mut(player: &mut PlayerSlot, pool_index: usize) -> &mut u64 {
    if pool_index == 0 {
        &mut player.frog_shares
    } else {
        &mut player.cat_shares
    }
}

fn trade_math_error(error: math::MathError) -> Error {
    match error {
        math::MathError::InvalidAmount => error!(GameError::InvalidTradeAmount),
        math::MathError::EmptyReserve => error!(GameError::EmptyReserve),
        math::MathError::ZeroOutput => error!(GameError::ZeroOutput),
        math::MathError::Overflow => error!(GameError::Overflow),
    }
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
    #[msg("Choose Frog or Cat pool")]
    InvalidPool,
    #[msg("Trade input or minimum output is outside its allowed range")]
    InvalidTradeAmount,
    #[msg("This wallet has insufficient virtual credits")]
    InsufficientCredits,
    #[msg("This wallet has insufficient virtual shares")]
    InsufficientShares,
    #[msg("The trade output is below the requested minimum")]
    SlippageExceeded,
    #[msg("The trade nonce does not match")]
    InvalidNonce,
    #[msg("A virtual pool reserve is empty")]
    EmptyReserve,
    #[msg("The trade would produce zero output")]
    ZeroOutput,
    #[msg("Only the approved demo organizer may create a match")]
    InvalidOrganizer,
    #[msg("The scoring team has not been chosen")]
    TeamNotChosen,
    #[msg("The timing challenge result has expired")]
    AttemptExpired,
    #[msg("The timing score is invalid")]
    InvalidScore,
    #[msg("The timing challenge nonce is invalid or already used")]
    InvalidChallengeNonce,
    #[msg("The three-attempt limit has been reached")]
    AttemptLimit,
    #[msg("The attempt index is not next in sequence")]
    InvalidAttemptIndex,
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

    fn live_match() -> (Match, Pubkey, Pubkey) {
        let mut game = empty_match();
        let frog = Pubkey::new_unique();
        let cat = Pubkey::new_unique();
        game.join(frog, 0).unwrap();
        game.join(cat, 0).unwrap();
        game.choose_team(frog, Team::Frog as u8, 0).unwrap();
        game.choose_team(cat, Team::Cat as u8, 0).unwrap();
        game.start(0).unwrap();
        (game, frog, cat)
    }

    fn conserved(game: &Match) -> bool {
        let credits: u128 = game
            .credit_reserves
            .iter()
            .map(|&value| u128::from(value))
            .sum::<u128>()
            + game
                .active_players()
                .unwrap()
                .iter()
                .map(|player| u128::from(player.credits))
                .sum::<u128>();
        let frog_shares: u128 = u128::from(game.share_reserves[0])
            + game
                .active_players()
                .unwrap()
                .iter()
                .map(|player| u128::from(player.frog_shares))
                .sum::<u128>();
        let cat_shares: u128 = u128::from(game.share_reserves[1])
            + game
                .active_players()
                .unwrap()
                .iter()
                .map(|player| u128::from(player.cat_shares))
                .sum::<u128>();
        credits == 22_000
            && frog_shares == u128::from(INITIAL_SHARE_RESERVE)
            && cat_shares == u128::from(INITIAL_SHARE_RESERVE)
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
        assert_eq!(Match::LEN, 1078);
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
        assert_eq!(decoded.players[9].trade_nonce, 0);
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

    #[test]
    fn buys_and_sells_change_only_the_selected_pool_and_preserve_supply() {
        let (mut game, frog, cat) = live_match();
        let frog_before = (game.credit_reserves[0], game.share_reserves[0]);
        game.buy_shares(frog, 0, 100, 1, 0, 1).unwrap();
        assert!(game.credit_reserves[0] > frog_before.0);
        assert!(game.share_reserves[0] < frog_before.1);
        assert_eq!(game.credit_reserves[1], INITIAL_CREDIT_RESERVE);
        assert_eq!(game.share_reserves[1], INITIAL_SHARE_RESERVE);
        assert!(conserved(&game));
        game.buy_shares(cat, 1, 100, 1, 0, 1).unwrap();
        let cat_before = (game.credit_reserves[1], game.share_reserves[1]);
        game.sell_shares(cat, 1, MIN_SELL_SHARES, 1, 1, 2).unwrap();
        assert!(game.credit_reserves[1] < cat_before.0);
        assert!(game.share_reserves[1] > cat_before.1);
        assert!(conserved(&game));
        assert_eq!(game.team_scores, [0; 2]);
        assert_eq!(game.outcome, MatchOutcome::Pending as u8);
    }

    #[test]
    fn failed_trades_leave_balances_and_nonce_unchanged() {
        let (mut game, frog, cat) = live_match();
        assert!(game.buy_shares(frog, 0, 100, 1, 0, 0).is_ok());
        let original = (
            game.credit_reserves,
            game.share_reserves,
            game.players[0].credits,
            game.players[0].frog_shares,
            game.players[0].trade_nonce,
        );
        for result in [
            game.buy_shares(frog, 0, 100, 1, 0, 1),
            game.buy_shares(frog, 2, 100, 1, 1, 1),
            game.buy_shares(frog, 0, 0, 1, 1, 1),
            game.buy_shares(frog, 0, 251, 1, 1, 1),
            game.buy_shares(frog, 0, 100, u64::MAX, 1, 1),
            game.sell_shares(frog, 0, 1, 1, 1, 1),
            game.sell_shares(frog, 0, MAX_SELL_SHARES + 1, 1, 1, 1),
            game.sell_shares(frog, 0, MAX_SELL_SHARES, 1, 1, 1),
            game.sell_shares(cat, 0, MIN_SELL_SHARES, 1, 0, 1),
            game.buy_shares(Pubkey::new_unique(), 0, 1, 1, 0, 1),
            game.buy_shares(frog, 0, 100, 1, 1, 90),
        ] {
            assert!(result.is_err());
        }
        assert_eq!(
            (
                game.credit_reserves,
                game.share_reserves,
                game.players[0].credits,
                game.players[0].frog_shares,
                game.players[0].trade_nonce
            ),
            original
        );
        game.players[0].credits = 0;
        assert!(game.buy_shares(frog, 0, 1, 1, 1, 1).is_err());
        game.players[0].credits = original.2;
        game.players[0].frog_shares = u64::MAX;
        assert!(game.buy_shares(frog, 0, 1, 1, 1, 1).is_err());
        game.players[0].frog_shares = original.3;
        game.players[0].trade_nonce = u64::MAX;
        assert!(game.buy_shares(frog, 0, 1, 1, u64::MAX, 1).is_err());
        game.players[0].trade_nonce = original.4;
        assert_eq!(game.credit_reserves, original.0);
        assert_eq!(game.share_reserves, original.1);
        game.close_round(90).unwrap();
        assert!(game
            .sell_shares(frog, 0, MIN_SELL_SHARES, 1, 1, 91)
            .is_err());
    }

    #[test]
    fn deterministic_trades_conserve_supply_and_round_trip_cannot_mint_credits() {
        let (mut game, frog, _) = live_match();
        let mut seed = 0x1234_5678_u64;
        for _ in 0..80 {
            seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            let amount = 1 + (seed % 150);
            let pool = (seed >> 17) as u8 % 2;
            let index = usize::from(pool);
            let before_k =
                u128::from(game.credit_reserves[index]) * u128::from(game.share_reserves[index]);
            let before_credits = game.players[0].credits;
            let before_shares = player_shares(&game.players[0], index);
            let nonce = game.players[0].trade_nonce;
            if amount > before_credits || game.buy_shares(frog, pool, amount, 1, nonce, 1).is_err()
            {
                continue;
            }
            let gained = player_shares(&game.players[0], index) - before_shares;
            if gained >= MIN_SELL_SHARES && gained <= MAX_SELL_SHARES {
                let nonce = game.players[0].trade_nonce;
                game.sell_shares(frog, pool, gained, 1, nonce, 1).unwrap();
                assert!(game.players[0].credits <= before_credits);
            }
            let after_k =
                u128::from(game.credit_reserves[index]) * u128::from(game.share_reserves[index]);
            assert!(after_k >= before_k);
            assert!(conserved(&game));
        }
    }

    #[test]
    fn verified_attempts_track_best_score_and_each_perfect_attempt() {
        let (mut game, frog, cat) = live_match();
        game.apply_verified_attempt(frog, 1, 11, 60, 20, 10)
            .unwrap();
        assert_eq!(game.team_scores, [60, 0]);
        game.apply_verified_attempt(frog, 2, 12, 30, 20, 11)
            .unwrap();
        assert_eq!(game.team_scores, [60, 0]);
        game.apply_verified_attempt(frog, 3, 13, 100, 20, 12)
            .unwrap();
        game.apply_verified_attempt(cat, 1, 21, 100, 20, 12)
            .unwrap();
        game.apply_verified_attempt(cat, 2, 22, 100, 20, 12)
            .unwrap();
        assert_eq!(game.team_scores, [100, 100]);
        assert_eq!(game.players[0].perfect_attempts, 1);
        assert_eq!(game.players[1].perfect_attempts, 2);
        assert_eq!(game.players[0].used_challenge_nonces, [11, 12, 13]);
        assert_eq!(game.players[0].attempts_used, 3);
        assert_eq!(game.outcome, MatchOutcome::Pending as u8);
    }

    #[test]
    fn invalid_attempts_do_not_mutate_score_or_attempt_budget() {
        let (mut game, frog, _) = live_match();
        assert!(game.apply_verified_attempt(frog, 1, 11, 60, 9, 10).is_err());
        assert!(game
            .apply_verified_attempt(frog, 2, 11, 60, 20, 10)
            .is_err());
        assert!(game.apply_verified_attempt(frog, 1, 0, 60, 20, 10).is_err());
        assert!(game
            .apply_verified_attempt(frog, 1, 11, 99, 20, 10)
            .is_err());
        assert!(game
            .apply_verified_attempt(Pubkey::new_unique(), 1, 11, 60, 20, 10)
            .is_err());
        assert_eq!(game.team_scores, [0, 0]);
        assert_eq!(game.players[0].attempts_used, 0);
        game.apply_verified_attempt(frog, 1, 11, 60, 20, 10)
            .unwrap();
        assert!(game
            .apply_verified_attempt(frog, 1, 11, 60, 20, 10)
            .is_err());
        assert!(game
            .apply_verified_attempt(frog, 2, 11, 60, 20, 10)
            .is_err());
        assert_eq!(game.team_scores, [60, 0]);
        assert_eq!(game.players[0].attempts_used, 1);
        game.apply_verified_attempt(frog, 2, 12, 0, 20, 10).unwrap();
        game.apply_verified_attempt(frog, 3, 13, 30, 20, 10)
            .unwrap();
        assert!(game
            .apply_verified_attempt(frog, 4, 14, 100, 20, 10)
            .is_err());
        assert_eq!(game.team_scores, [60, 0]);
        assert_eq!(game.players[0].attempts_used, 3);
        assert!(game
            .apply_verified_attempt(frog, 4, 14, 100, 100, 90)
            .is_err());
    }

    #[test]
    fn unchosen_team_and_expired_round_cannot_score() {
        let (mut game, frog, _) = live_match();
        let unchosen = Pubkey::new_unique();
        game.join(unchosen, 1).unwrap();
        assert!(game
            .apply_verified_attempt(unchosen, 1, 33, 30, 20, 10)
            .is_err());
        assert!(game
            .apply_verified_attempt(frog, 1, 33, 30, 100, 90)
            .is_err());
        game.close_round(90).unwrap();
        assert!(game
            .apply_verified_attempt(frog, 1, 33, 30, 100, 91)
            .is_err());
    }
}
