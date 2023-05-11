import fs from "fs";
import moment from "moment";
import Papa from "papaparse";
import { PriceData } from "./types";
import {
  calculateExitSoldInUSD,
  calculateLiquidationPrice,
  calculateProfitLimit,
  calculateProfitOrLoss,
  calculateRemainingAmount,
  isLiquidated,
  isProfitTaken,
} from "./utils";

interface PriceDataParsed {
  Timestamp: string;
  Open: string;
  High: string;
  Low: string;
  Close: string;
}

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
 * Calculates the DCA strategy with leverage considering liquidation.
 *
 * @param data - The array of historical Bitcoin prices.
 * @param buyFrequency - The frequency of buying Bitcoin in days.
 * @param buyAmount - The amount in dollars to be spent on buying Bitcoin each time.
 * @param tradeDurationInHours - The duration of the leveraged position in hours.
 * @param leverage - The leverage level (e.g. 5, 10, 15, 20x).
 * @returns number - The total amount of Bitcoin obtained using DCA with leverage.
 */
function dcaWithLeverage(
  data: PriceData[],
  buyFrequencyInHours: number,
  buyAmount: number,
  tradeDurationInHours: number,
  leverage: number,
  profitInPercent: number = 100,
  long: boolean = true
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
    const liquidationPrice = calculateLiquidationPrice(
      entryPrice,
      leverage,
      long
    );
    //console.log("liquidationPrice", liquidationPrice);

    // Check if the liquidation price is hit within the long duration
    let liquidated = false;

    // Calculate a profit limit price based on profit in percentage and leverage
    let profitLimitPrice = calculateProfitLimit(
      entryPrice,
      profitInPercent,
      leverage,
      long
    );
    //console.log("profitLimitPrice", profitLimitPrice);

    // Check if the profit limit price is hit within the trade duration
    let profitTaken = false;
    const exitIndex = i + tradeDurationInHours;

    for (let j = i + 1; j <= exitIndex; j++) {
      if (isLiquidated(data[j], liquidationPrice, long)) {
        liquidated = true;
        liquidationsCount++;
        break;
      }

      if (isProfitTaken(data[j], profitLimitPrice, long)) {
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
      // If not liquidated, at the end of the trade duration, sell the Bitcoin bought
      // Calculate the value of the closed position
      let exitSoldAmountInUSD = calculateExitSoldInUSD(
        btcBought,
        profitTaken,
        profitLimitPrice,
        data[exitIndex]
      );

      // Calulate the profit or loss considering the leverage
      const profitOrLoss = calculateProfitOrLoss(
        exitSoldAmountInUSD,
        btcBought,
        entryPrice,
        long
      );

      let remaningAmount = calculateRemainingAmount(profitOrLoss, buyAmount);
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
  const longDurationInHours = 24 * 3;
  const dcaDurationInDays = 365;
  const startingDate = "2021-01-01";
  const startingHour = "12:00";

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

  const leverage = 30;
  const profitInPercent = 400;

  console.log("Long strategy results:");
  console.table(
    dcaWithLeverage(
      filteredData,
      buyFrequencyInHours,
      dcaAmount,
      longDurationInHours,
      leverage,
      profitInPercent
    )
  );

  console.log("Short strategy results:");
  console.table(
    dcaWithLeverage(
      filteredData,
      buyFrequencyInHours,
      dcaAmount,
      longDurationInHours,
      leverage,
      profitInPercent,
      false
    )
  );

  // Simulate the DCA strategy with different leverage and profit limit values

  /*simulateEveryLeverages(
    filteredData,
    wallet,
    buyFrequencyInHours,
    dcaAmount,
    longDurationInHours
  );*/
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
