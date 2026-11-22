use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("FZACcydNJBwxXUGYB1u5tRFWtmriR97PuBTYnPVskAWs");

pub const MAX_PLAYERS: usize = 10;
pub const ROUND_SECONDS: i64 = 90;
pub const STARTING_CREDITS: u64 = 1_000;

#[ephemeral]
#[program]
pub mod meme_wars {
    use super::*;

    /// Create the durable match account on Solana before delegation.
    pub fn initialize_match(ctx: Context<InitializeMatch>, match_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.authority = ctx.accounts.authority.key();
        game.match_id = match_id;
        game.status = MatchStatus::Scheduled as u8;
        game.credit_reserves = [10_000; 2];
        game.share_reserves = [1_000; 2];
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
        let game = &mut ctx.accounts.game;
        require!(
            game.status == MatchStatus::Scheduled as u8 || game.status == MatchStatus::Live as u8,
            GameError::Closed
        );
        let wallet = ctx.accounts.player.key();
        require!(
            !game.players[..game.player_count as usize]
                .iter()
                .any(|entry| entry.wallet == wallet),
            GameError::AlreadyJoined
        );
        require!((game.player_count as usize) < MAX_PLAYERS, GameError::Full);
        let index = game.player_count as usize;
        let slot = &mut game.players[index];
        slot.wallet = wallet;
        slot.credits = STARTING_CREDITS;
        game.player_count += 1;
        Ok(())
    }

    /// Start the 90-second round on the ER after players have joined.
    pub fn start_match(ctx: Context<AuthorityMatch>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.status == MatchStatus::Scheduled as u8,
            GameError::InvalidStatus
        );
        let now = Clock::get()?.unix_timestamp;
        game.started_at = now;
        game.ends_at = now.checked_add(ROUND_SECONDS).ok_or(GameError::Overflow)?;
        game.status = MatchStatus::Live as u8;
        Ok(())
    }

    /// Persist the current delegated state to Solana. Call on the ER.
    pub fn commit_match(ctx: Context<SettleMatch>) -> Result<()> {
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
#[instruction(match_id: u64)]
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
    pub match_id: u64,
    pub status: u8,
    pub started_at: i64,
    pub ends_at: i64,
    pub credit_reserves: [u64; 2],
    pub share_reserves: [u64; 2],
    pub team_scores: [u64; 2],
    pub players: [PlayerSlot; MAX_PLAYERS],
    pub player_count: u8,
    pub bump: u8,
}

impl Match {
    pub const LEN: usize =
        32 + 8 + 1 + 8 + 8 + 16 + 16 + 16 + PlayerSlot::LEN * MAX_PLAYERS + 1 + 1;
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
    Finalized = 2,
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
}

#[cfg(test)]
mod baseline_tests {
    use super::*;

    #[test]
    fn match_account_fits_declared_allocation_and_round_trips() {
        let authority = Pubkey::new_unique();
        let game = Match {
            authority,
            match_id: 7,
            status: MatchStatus::Scheduled as u8,
            started_at: 0,
            ends_at: 0,
            credit_reserves: [10_000; 2],
            share_reserves: [1_000; 2],
            team_scores: [0; 2],
            players: [PlayerSlot::default(); MAX_PLAYERS],
            player_count: 0,
            bump: 254,
        };

        let mut encoded = Vec::new();
        game.try_serialize(&mut encoded).unwrap();
        assert_eq!(encoded.len(), 8 + Match::LEN);

        let decoded = Match::try_deserialize(&mut encoded.as_slice()).unwrap();
        assert_eq!(decoded.authority, authority);
        assert_eq!(decoded.match_id, 7);
        assert_eq!(decoded.credit_reserves, [10_000; 2]);
        assert_eq!(decoded.share_reserves, [1_000; 2]);
        assert_eq!(decoded.player_count, 0);
    }
}
