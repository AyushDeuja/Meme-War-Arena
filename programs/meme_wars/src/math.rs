//! Deterministic quotes for the two virtual, fee-free constant-product pools.
//! Credits have zero decimal places; shares have six. This module performs no
//! account mutation. Trade instructions and their limits arrive in Phase 4.

pub const SHARE_SCALE: u64 = 1_000_000;
pub const PRICE_MILLI_SCALE: u64 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    InvalidAmount,
    EmptyReserve,
    ZeroOutput,
    Overflow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuyQuote {
    pub credits_in: u64,
    pub shares_out: u64,
    pub new_credit_reserve: u64,
    pub new_share_reserve: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SellQuote {
    pub shares_in: u64,
    pub credits_out: u64,
    pub new_credit_reserve: u64,
    pub new_share_reserve: u64,
}

fn checked_ceil_div(numerator: u128, denominator: u128) -> Result<u128, MathError> {
    if denominator == 0 {
        return Err(MathError::EmptyReserve);
    }
    let quotient = numerator / denominator;
    if numerator % denominator == 0 {
        Ok(quotient)
    } else {
        quotient.checked_add(1).ok_or(MathError::Overflow)
    }
}

fn invariant(credits: u64, shares: u64) -> Result<u128, MathError> {
    if credits == 0 || shares == 0 {
        return Err(MathError::EmptyReserve);
    }
    u128::from(credits)
        .checked_mul(u128::from(shares))
        .ok_or(MathError::Overflow)
}

pub fn quote_buy(
    credit_reserve: u64,
    share_reserve: u64,
    credits_in: u64,
) -> Result<BuyQuote, MathError> {
    if credits_in == 0 {
        return Err(MathError::InvalidAmount);
    }
    let k = invariant(credit_reserve, share_reserve)?;
    let new_credit_reserve = credit_reserve
        .checked_add(credits_in)
        .ok_or(MathError::Overflow)?;
    let new_share_reserve = u64::try_from(checked_ceil_div(k, u128::from(new_credit_reserve))?)
        .map_err(|_| MathError::Overflow)?;
    let shares_out = share_reserve
        .checked_sub(new_share_reserve)
        .ok_or(MathError::Overflow)?;
    if shares_out == 0 {
        return Err(MathError::ZeroOutput);
    }
    Ok(BuyQuote {
        credits_in,
        shares_out,
        new_credit_reserve,
        new_share_reserve,
    })
}

pub fn quote_sell(
    credit_reserve: u64,
    share_reserve: u64,
    shares_in: u64,
) -> Result<SellQuote, MathError> {
    if shares_in == 0 {
        return Err(MathError::InvalidAmount);
    }
    let k = invariant(credit_reserve, share_reserve)?;
    let new_share_reserve = share_reserve
        .checked_add(shares_in)
        .ok_or(MathError::Overflow)?;
    let new_credit_reserve = u64::try_from(checked_ceil_div(k, u128::from(new_share_reserve))?)
        .map_err(|_| MathError::Overflow)?;
    let credits_out = credit_reserve
        .checked_sub(new_credit_reserve)
        .ok_or(MathError::Overflow)?;
    if credits_out == 0 {
        return Err(MathError::ZeroOutput);
    }
    Ok(SellQuote {
        shares_in,
        credits_out,
        new_credit_reserve,
        new_share_reserve,
    })
}

/// Floor the displayed spot price to thousandths of a credit per whole share.
/// This quote is informational; trade outputs use the reserve formulas above.
pub fn spot_price_milli_credits(credit_reserve: u64, share_reserve: u64) -> Result<u64, MathError> {
    invariant(credit_reserve, share_reserve)?;
    let numerator = u128::from(credit_reserve)
        .checked_mul(u128::from(SHARE_SCALE))
        .and_then(|value| value.checked_mul(u128::from(PRICE_MILLI_SCALE)))
        .ok_or(MathError::Overflow)?;
    u64::try_from(numerator / u128::from(share_reserve)).map_err(|_| MathError::Overflow)
}

/// Indicative mark-to-market value in whole virtual credits. Each holding is
/// valued at the frozen pool spot ratio and rounded down independently.
pub fn indicative_portfolio_credits(
    available_credits: u64,
    frog_shares: u64,
    cat_shares: u64,
    credit_reserves: [u64; 2],
    share_reserves: [u64; 2],
) -> Result<u64, MathError> {
    let mut total = u128::from(available_credits);
    for (index, quantity) in [frog_shares, cat_shares].into_iter().enumerate() {
        invariant(credit_reserves[index], share_reserves[index])?;
        let value = u128::from(quantity)
            .checked_mul(u128::from(credit_reserves[index]))
            .ok_or(MathError::Overflow)?
            / u128::from(share_reserves[index]);
        total = total.checked_add(value).ok_or(MathError::Overflow)?;
    }
    u64::try_from(total).map_err(|_| MathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ceil_rounding_preserves_invariant_in_both_directions() {
        let buy = quote_buy(10, 10, 3).unwrap();
        assert_eq!(buy.shares_out, 2);
        assert_eq!((buy.new_credit_reserve, buy.new_share_reserve), (13, 8));
        assert!(invariant(13, 8).unwrap() >= invariant(10, 10).unwrap());

        let sell = quote_sell(10, 10, 3).unwrap();
        assert_eq!(sell.credits_out, 2);
        assert_eq!((sell.new_credit_reserve, sell.new_share_reserve), (8, 13));
        assert!(invariant(8, 13).unwrap() >= invariant(10, 10).unwrap());
    }

    #[test]
    fn initial_price_and_portfolio_use_share_scale() {
        assert_eq!(
            spot_price_milli_credits(10_000, 1_000 * SHARE_SCALE),
            Ok(10_000)
        );
        assert_eq!(
            indicative_portfolio_credits(
                100,
                SHARE_SCALE,
                SHARE_SCALE / 2,
                [10_000; 2],
                [1_000 * SHARE_SCALE; 2]
            ),
            Ok(115)
        );
        assert_eq!(
            indicative_portfolio_credits(0, 99_999, 0, [10_000; 2], [1_000 * SHARE_SCALE; 2]),
            Ok(0)
        );
    }

    #[test]
    fn tiny_and_invalid_inputs_do_not_create_value() {
        assert_eq!(quote_buy(10, 1, 1), Err(MathError::ZeroOutput));
        assert_eq!(
            quote_sell(10_000, 1_000 * SHARE_SCALE, 1),
            Err(MathError::ZeroOutput)
        );
        assert_eq!(quote_buy(10, 10, 0), Err(MathError::InvalidAmount));
        assert_eq!(quote_sell(10, 10, 0), Err(MathError::InvalidAmount));
        assert_eq!(quote_buy(0, 10, 1), Err(MathError::EmptyReserve));
        assert_eq!(quote_sell(10, 0, 1), Err(MathError::EmptyReserve));
        assert_eq!(
            spot_price_milli_credits(10, 0),
            Err(MathError::EmptyReserve)
        );
    }

    #[test]
    fn overflow_is_reported_without_wraparound() {
        assert_eq!(quote_buy(u64::MAX, 10, 1), Err(MathError::Overflow));
        assert_eq!(quote_sell(10, u64::MAX, 1), Err(MathError::Overflow));
        assert_eq!(
            indicative_portfolio_credits(u64::MAX, SHARE_SCALE, 0, [10_000; 2], [SHARE_SCALE; 2]),
            Err(MathError::Overflow)
        );
    }

    #[test]
    fn buy_then_sell_cannot_increase_credits() {
        for credits_in in 1..=250 {
            let buy = quote_buy(10_000, 1_000 * SHARE_SCALE, credits_in).unwrap();
            let sell = quote_sell(
                buy.new_credit_reserve,
                buy.new_share_reserve,
                buy.shares_out,
            );
            match sell {
                Ok(sell) => {
                    assert!(sell.credits_out <= credits_in);
                    assert!(
                        invariant(sell.new_credit_reserve, sell.new_share_reserve).unwrap()
                            >= invariant(10_000, 1_000 * SHARE_SCALE).unwrap()
                    );
                }
                Err(MathError::ZeroOutput) => {} // The dust sale cannot create credits.
                Err(error) => panic!("unexpected sell error: {error:?}"),
            }
        }
    }
}
