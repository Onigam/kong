import { PriceData } from "./types";

export function calculateRemainingAmount(
  profitOrLoss: number,
  buyAmount: number
): number {
  return profitOrLoss + buyAmount;
}

export function calculateExitSoldInUSD(
  btcBought: number,
  profitTaken: boolean,
  profitLimitPrice: number,
  exitCandle: PriceData
): number {
  return btcBought * (profitTaken ? profitLimitPrice : exitCandle.close);
}

export function calculateProfitOrLoss(
  exitSoldAmountInUSD: number,
  btcBought: number,
  entryPrice: number,
  long: boolean = true
) {
  return long
    ? exitSoldAmountInUSD - btcBought * entryPrice
    : btcBought * entryPrice - exitSoldAmountInUSD;
}

/**
 * Calculates the liquidation price for a long position with leverage.
 * The liquidation price is the price at which the position is closed automatically.
 * It is calculated based on the leverage level and the distance in percent between the entry price and the liquidation price.
 *
 * For example, if the entry price is $10,000 and the leverage is 25x,
 * the liquidation price will be $9,600:
 *
 * 10000 - ((100 / 25) / 100) * 10000 = 9600
 *
 * Verify calculation here https://leverage.trading/liquidation-price-calculator/
 *
 * @param entryPrice - The entry price of the leveraged position.
 * @param leverage - The leverage level (e.g. 5, 10, 15, 20x).
 * @param long - If true, calculates the liquidation price for a long position. If false, calculates the liquidation price for a short position.
 * @returns
 * TODO put fees as a variable
 */
export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  long: boolean = true
): number {
  const distance = 100 / leverage;
  const distanceInDollars = (distance / 100) * entryPrice;
  const liquidationPrice = long
    ? entryPrice - distanceInDollars
    : entryPrice + distanceInDollars;

  return liquidationPrice;
}

/**
 * Calculates the profit limit price for a long position with leverage.
 * The profit limit price is the price at which the position is closed automatically.
 * It is calculated based on the leverage level and the profit in percent.
 *
 * For example, if the entry price is $10,000 and the profit in percent is 200%,
 * the profit limit price will be $11,000:
 *
 * 10000 + ((10000 * 200) / 100) / 20 = 11000
 *
 * Verify the calculation here: https://www.binance.com/en/futures/BTCUSDT_PERPETUAL/calculator
 *
 * @param entryPrice - The entry price of the leveraged position.
 * @param profitInPercent - The profit limit in percent (e.g. 100, 200, 300%).
 * @param leverage - The leverage level (e.g. 5, 10, 15, 20x).
 * @param long - If true, calculates the profit limit price for a long position. If false, calculates the profit limit price for a short position.
 * @returns
 */
export function calculateProfitLimit(
  entryPrice: number,
  profitInPercent: number,
  leverage: number,
  long: boolean = true
): number {
  if (long) {
    return entryPrice + (entryPrice * profitInPercent) / 100 / leverage;
  } else {
    return entryPrice - (entryPrice * profitInPercent) / 100 / leverage;
  }
}

export function isLiquidated(
  candle: PriceData,
  liquidationPrice: number,
  long: boolean = true
): boolean {
  return long
    ? candle.low <= liquidationPrice
    : candle.high >= liquidationPrice;
}

export function isProfitTaken(
  candle: PriceData,
  profitLimitPrice: number,
  long: boolean = true
): boolean {
  return long
    ? candle.high >= profitLimitPrice
    : candle.low <= profitLimitPrice;
}
