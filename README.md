# kong

This is a Bitcoin DCA on stéroide simulation tool.

It takes historical BTC - USDT data from Binance and simulate a DCA leveraged strategy on it.

It takes those parameters as input in `index.ts`:

```bash
  const dcaAmount = 100;
  const frequencyInDays = 3;
  const longDurationInHours = 24 * 3;
  const dcaDurationInDays = 365 * 3;
  const startingDate = "2020-11-08";
  const startingHour = "22:00";
```

Based on those parameters it will simulate every buy long position,
with leverage from 5 to 100% of the buy amount, with take profit from 50 to 1000% of the buy amount and buy back of bitcoin
1 hour the closing of the position.

It will then output the result for the specified period of time sorted by bitcoin accumulated percentage in addition of a classic DCA strategy.

## How to use

### Install

```bash

npm install

npx ts-node src/index.ts

```