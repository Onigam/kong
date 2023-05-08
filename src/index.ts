import fs from "fs";
import moment from "moment";
import Papa from "papaparse";

interface PriceDataParsed {
  Timestamp: string;
  Open: string;
  High: string;
  Low: string;
  Close: string;
}

interface PriceData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Parses a local CSV file and returns an array of PriceData objects.
 * @param file - The path to the CSV file.
 * @returns Promise<PriceData[]> - An array of historical Bitcoin prices with timestamp and closing price.
 */
/**
 * Parses a local CSV file and returns an array of PriceData objects.
 * @param file - The path to the CSV file.
 * @returns Promise<PriceData[]> - An array of historical Bitcoin prices with timestamp and closing price.
 */
async function parseCSV(file: string): Promise<PriceData[]> {
  const data: PriceData[] = [];

  try {
    const fileContentBuffer = await fs.promises.readFile(file);
    const fileContent = fileContentBuffer.toString("utf8");
    const parsedData = Papa.parse<PriceDataParsed>(fileContent, {
      header: true,
      skipEmptyLines: "greedy",
    });

    parsedData.data.forEach((entry) => {
      data.push({
        timestamp: parseInt(entry.Timestamp),
        open: parseFloat(entry.Open),
        high: parseFloat(entry.High),
        low: parseFloat(entry.Low),
        close: parseFloat(entry.Close),
      });
    });

    return data;
  } catch (err) {
    throw new Error(`Error reading and parsing CSV file: ${err}`);
  }
}

/**
 * Calculates the DCA strategy without leverage.
 * @param data - The array of historical Bitcoin prices.
 * @param buyFrequency - The frequency of buying Bitcoin in days.
 * @param buyAmount - The amount in dollars to be spent on buying Bitcoin each time.
 * @returns number - The total amount of Bitcoin obtained using DCA without leverage.
 */
function dca(
  data: PriceData[],
  buyFrequencyInHours: number,
  buyAmount: number
): number {
  let wallet = 0;

  for (let i = 0; i < data.length; i += buyFrequencyInHours) {
    const btcBought = buyAmount / data[i].close;
    wallet += btcBought;
  }

  return wallet;
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
 * @param entryPrice
 * @param leverage
 * @returns
 * TODO put fees as a variable
 */
function calculateLongLiquidationPrice(
  entryPrice: number,
  leverage: number
): number {
  const distance = 100 / leverage;
  const distanceInDollars = (distance / 100) * entryPrice;
  const liquidationPrice = entryPrice - distanceInDollars;

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
 * @param entryPrice
 * @param profitInPercent
 * @param leverage
 * @returns
 */
function calculateProfitLimit(
  entryPrice: number,
  profitInPercent: number,
  leverage: number
): number {
  return entryPrice + (entryPrice * profitInPercent) / 100 / leverage;
}

/**
 * Calculates the DCA strategy with leverage considering liquidation.
 * @param data - The array of historical Bitcoin prices.
 * @param buyFrequency - The frequency of buying Bitcoin in days.
 * @param buyAmount - The amount in dollars to be spent on buying Bitcoin each time.
 * @param longDurationHours - The duration of the leveraged long position in hours.
 * @param leverage - The leverage level (e.g. 5, 10, 15, 20x).
 * @returns number - The total amount of Bitcoin obtained using DCA with leverage.
 */
function dcaWithLeverage(
  data: PriceData[],
  buyFrequencyInHours: number,
  buyAmount: number,
  longDurationHours: number,
  leverage: number,
  profitInPercent: number = 100
): {
  wallet: number;
  liquidationsCount: number;
  takeProfitsCount: number;
  closedPositionsCount: number;
} {
  let wallet = 0;
  let liquidationsCount = 0;
  let takeProfitsCount = 0;
  let closedPositionsCount = 0;

  for (
    let i = 0;
    i + buyFrequencyInHours < data.length;
    i += buyFrequencyInHours
  ) {
    const entryPrice = data[i].open;
    //console.log("entryPrice", entryPrice);

    // Calculate the amount of Bitcoin bought with the buy amount and leverage
    const btcBought = (buyAmount * leverage) / entryPrice;

    // Calculate the liquidation price
    const liquidationPrice = calculateLongLiquidationPrice(
      entryPrice,
      leverage
    );
    //console.log("liquidationPrice", liquidationPrice);

    // Check if the liquidation price is hit within the long duration
    let liquidated = false;

    // Calculate a profit limit price based on profit in percentage and leverage
    let profitLimitPrice = calculateProfitLimit(
      entryPrice,
      profitInPercent,
      leverage
    );
    //console.log("profitLimitPrice", profitLimitPrice);

    // Check if the profit limit price is hit within the long duration
    let profitTaken = false;

    const exitIndex = i + longDurationHours;

    for (let j = i + 1; j <= exitIndex; j++) {
      if (data[j]?.low <= liquidationPrice) {
        liquidated = true;
        liquidationsCount++;
        break;
      }

      if (data[j]?.high >= profitLimitPrice) {
        profitTaken = true;
        takeProfitsCount++;
        break;
      }
    }

    if (!liquidated && !profitTaken) {
      closedPositionsCount++;
    }

    // If not liquidated, add the profit or loss to the wallet
    if (!liquidated) {
      // If not liquidated, at the end of the long duration, sell the Bitcoin bought
      const exitPrice = profitTaken ? profitLimitPrice : data[exitIndex].open;

      // Calculate the value of the Bitcoin sold
      const soldAmount = btcBought * exitPrice;

      // Calulate the profit or loss considering the leverage
      const profitOrLoss = soldAmount - btcBought * entryPrice;

      // TODO consider fees as a variable
      // Calculate the remaining amount to be paid back
      let remaningAmount;
      /*if (profitOrLoss < 0) {
        console.log("Loss --> ", profitOrLoss);
      } else {
        console.log("Profit -->", profitOrLoss);
      }*/

      remaningAmount = profitOrLoss + buyAmount;
      //console.log("remaningAmount", remaningAmount);

      // Here we consider that we rebuy bitcoin with the remaining value one 1h after the exit
      wallet += remaningAmount / data[exitIndex].close;
    }
  }

  return {
    wallet,
    liquidationsCount,
    takeProfitsCount,
    closedPositionsCount,
  };
}

/**
 * Filters the historical price data based on the starting date and starting hour.
 * @param data - The array of historical Bitcoin prices.
 * @param startDate - The starting date for the DCA strategy.
 * @param startHour - The starting hour for the DCA strategy in the 24-hour format (e.g., '00:00', '15:30', '23:59').
 * @returns PriceData[] - The filtered array of historical Bitcoin prices.
 */
function filterDataByDateAndHour(
  data: PriceData[],
  startDate: string,
  startHour: string
): PriceData[] {
  const startTime = moment(`${startDate} ${startHour}`, "YYYY-MM-DD HH:mm");
  return data.filter((entry) =>
    moment(entry.timestamp).isSameOrAfter(startTime)
  );
}

(async () => {
  const data = await parseCSV("data/btc_usdt.csv");

  const dcaAmount = 100;
  const frequencyInDays = 3;
  const longDurationInHours = 12;
  const dcaDurationInDays = 365 * 3;
  const startingDate = "2020-01-01";
  const startingHour = "2:00";

  // Filter data to include only the data points within the specified starting date, starting hour, and DCA duration
  const filteredData = filterDataByDateAndHour(
    data,
    startingDate,
    startingHour
  ).slice(0, dcaDurationInDays * 24);

  console.log("DCA amount in USDT", dcaAmount);
  console.log("DCA frequency", frequencyInDays);
  console.log("DCA duration", dcaDurationInDays);
  console.log("Long duration in hours", longDurationInHours);
  console.log("Starting date", startingDate);
  console.log("Starting hour", startingHour);

  // Calculate the DCA strategy results for both non-leveraged and leveraged approaches
  const buyFrequencyInHours = frequencyInDays * 24;
  const wallet = dca(filteredData, buyFrequencyInHours, dcaAmount);

  console.log("BTC accumulated with classic DCA", wallet.toFixed(4));

  const leverage = 50;
  const profitInPercent = 300;

  /*
  console.table(
    dcaWithLeverage(
      filteredData,
      buyFrequencyInHours,
      dcaAmount,
      longDurationInHours,
      leverage,
      profitInPercent
    )
  );*/

  // Simulate the DCA strategy with different leverage and profit limit values

  simulateEveryLeverages(
    filteredData,
    wallet,
    buyFrequencyInHours,
    dcaAmount,
    longDurationInHours
  );
})();

function simulateEveryLeverages(
  filteredData: PriceData[],
  dcaClassicWallet: number,
  buyFrequencyInHours: number,
  dcaAmount: number,
  longDurationInHours: number
) {
  let leverageResults = [];

  for (let i = 5; i <= 100; i++) {
    for (let j = 50; j <= 1000; j += 50) {
      const {
        wallet,
        closedPositionsCount,
        liquidationsCount,
        takeProfitsCount,
      } = dcaWithLeverage(
        filteredData,
        buyFrequencyInHours,
        dcaAmount,
        longDurationInHours,
        i,
        j
      );

      const diffenceInPercentage = (wallet / dcaClassicWallet) * 100 - 100;

      leverageResults.push({
        Leverage: i,
        "Auto take profit in %": j,
        "BTC accumulated": wallet.toFixed(4),
        "BTC accumulated in % vs classic DCA": diffenceInPercentage.toFixed(2),
        "Closed positions": closedPositionsCount,
        Liquidations: liquidationsCount,
        "Take profits": takeProfitsCount,
      });
    }
  }

  console.table(
    leverageResults.sort(
      (a: any, b: any) =>
        b["BTC accumulated in % vs classic DCA"] -
        a["BTC accumulated in % vs classic DCA"]
    )
  );
}
