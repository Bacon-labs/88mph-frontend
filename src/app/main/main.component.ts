import { Component, OnInit, Inject } from '@angular/core';

import { WEB3 } from '../web3';

import { ApolloAndWeb3Enabled } from '../apolloAndWeb3';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import BigNumber from 'bignumber.js';
declare var $: any;

@Component({
  selector: 'app-main',
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.css']
})
export class MainComponent extends ApolloAndWeb3Enabled implements OnInit {
  DECIMALS = 4;
  POOLS = {
    compoundV1:
    {
      name: "Compound V1",
      address: "0x9b226970cdeada0026aed50d02e4a0dd37c92b6f"
    },
    compoundV2:
    {
      name: "Compound",
      address: "0xebce73ed303eb97fa8060f276083444b9bbe63c1"
    },
    aaveV2:
    {
      name: "Aave",
      address: "0xdf907b483c7e7402555bcb1d8d3878ac3a38f07b"
    }
  };
  PRECISION = 1e18;
  MIN_DEPOSIT_PERIOD = 91;
  UIRMultiplier = new BigNumber(0.5);
  FEE = new BigNumber(0.1);
  NOOP = () => { };

  now: Date;

  oneYearInterestRate: BigNumber;
  totalActiveDeposit: BigNumber;
  totalInterestPaid: BigNumber;
  totalValue: BigNumber;
  numActiveUsers: BigNumber;
  bestPool: string;

  userAddress: string;
  userTotalInterestEarned: BigNumber;
  userTotalActiveDeposit: BigNumber;
  userDeposits: Array<Deposit>;

  selectedDeposit: Deposit;

  depositActionAmount: BigNumber;
  depositActionUserBalance: BigNumber;
  depositActionLockPeriod: BigNumber;
  depositActionAPY: BigNumber;
  depositActionInterest: BigNumber;

  withdrawActionAmount: BigNumber;

  earlyWithdrawActionUserBalance: BigNumber;

  txHash: string;
  confirmationIsDeposit: boolean;

  constructor(@Inject(WEB3) web3, private apollo: Apollo) {
    super(web3);

    this.now = new Date();
    setInterval(() => {
      this.now = new Date();
    }, 1e3);

    this.oneYearInterestRate = new BigNumber(0);
    this.totalActiveDeposit = new BigNumber(0);
    this.totalInterestPaid = new BigNumber(0);
    this.totalValue = new BigNumber(0);
    this.numActiveUsers = new BigNumber(0);
    this.bestPool = this.POOLS.compoundV2.address;

    this.userAddress = null;
    this.userTotalInterestEarned = new BigNumber(0);
    this.userTotalActiveDeposit = new BigNumber(0);
    this.userDeposits = new Array<Deposit>();

    this.depositActionAmount = new BigNumber(0);
    this.depositActionUserBalance = new BigNumber(0);
    this.depositActionLockPeriod = new BigNumber(this.MIN_DEPOSIT_PERIOD);
    this.depositActionAPY = new BigNumber(0);
    this.depositActionInterest = new BigNumber(0);

    this.withdrawActionAmount = new BigNumber(0);

    this.earlyWithdrawActionUserBalance = new BigNumber(0);

    this.txHash = '';
    this.confirmationIsDeposit = false;
  }

  ngOnInit(): void {
    this.connectWallet(true);
    this.createQuery();
  }

  createQuery() {
    this.query = this.apollo
      .watchQuery({
        pollInterval: this.pollInterval,
        fetchPolicy: this.fetchPolicy,
        query: gql`
          {
            dpoolList(id: "0") {
              numActiveUsers
            }
            compoundV1: dpool(id: "${this.POOLS.compoundV1.address}") {
              address
              totalActiveDeposit
              totalHistoricalDeposit
              totalInterestPaid
              numUsers
              numDeposits
              numActiveDeposits
              deficit
              oneYearInterestRate
            }
            compoundV2: dpool(id: "${this.POOLS.compoundV2.address}") {
              address
              totalActiveDeposit
              totalHistoricalDeposit
              totalInterestPaid
              numUsers
              numDeposits
              numActiveDeposits
              deficit
              oneYearInterestRate
            }
            aaveV2: dpool(id: "${this.POOLS.aaveV2.address}") {
              address
              totalActiveDeposit
              totalHistoricalDeposit
              totalInterestPaid
              numUsers
              numDeposits
              numActiveDeposits
              deficit
              oneYearInterestRate
            }
            ${this.userAddress ?
            `user(id: "${this.userAddress.toLowerCase()}") {
                numDeposits
                numActiveDeposits
                totalActiveDeposit
                totalHistoricalDeposit
                totalInterestEarned
                deposits(first: 1000, where: {active: true}, orderBy: depositTimestamp, orderDirection: desc) {
                  idx
                  pool {
                    address
                  }
                  amount
                  maturationTimestamp
                  interestEarned
                  depositTimestamp
                }
              }
              ` : ''
          }
          }
        `
      });
    this.querySubscription = this.query.valueChanges.subscribe((result) => this.handleQuery(result));
  }

  handleQuery({ data, loading }) {
    if (!loading) {
      const poolList = data.dpoolList;
      const compoundV1 = data.compoundV1;
      const compoundV2 = data.compoundV2;
      const aaveV2 = data.aaveV2;
      const pools = [compoundV1, compoundV2, aaveV2];

      // Pool stats
      const maxOneYearInterestRate = Math.max(...[+compoundV2.oneYearInterestRate, +aaveV2.oneYearInterestRate]);
      this.bestPool = pools.slice(1).reduce((a, b) => +a.oneYearInterestRate > +b.oneYearInterestRate ? a : b).address;
      this.oneYearInterestRate = this.applyFee(new BigNumber(maxOneYearInterestRate).times(100)); // In percent
      const sumPoolProp = prop => pools.map(p => new BigNumber(p[prop])).reduce((a, b) => a.plus(b));
      this.totalActiveDeposit = sumPoolProp('totalActiveDeposit');
      this.totalInterestPaid = sumPoolProp('totalInterestPaid');
      const totalDeficit = sumPoolProp('deficit');
      this.totalValue = this.totalActiveDeposit.plus(totalDeficit);
      this.numActiveUsers = new BigNumber(poolList.numActiveUsers);

      if (data.user) {
        const user = data.user;
        const deposits = user.deposits;

        this.userTotalActiveDeposit = new BigNumber(user.totalActiveDeposit);
        this.userTotalInterestEarned = new BigNumber(user.totalInterestEarned);
        this.userDeposits = deposits.map((rawDeposit) => {
          return {
            idx: new BigNumber(rawDeposit.idx),
            pool: rawDeposit.pool.address,
            amount: new BigNumber(rawDeposit.amount),
            maturationTimestamp: this.toDateObject(rawDeposit.maturationTimestamp),
            interestEarned: new BigNumber(rawDeposit.interestEarned),
            depositTimestamp: this.toDateObject(rawDeposit.depositTimestamp),
            canEarlyWithdraw: rawDeposit.pool.address !== this.POOLS.compoundV1.address
          } as Deposit;
        });
      } else {
        this.userTotalInterestEarned = new BigNumber(0);
        this.userTotalActiveDeposit = new BigNumber(0);
        this.userDeposits = new Array<Deposit>();
      }
    }
  }

  refreshDisplay() {
    this.unsubQuery();
    this.createQuery();
  }

  connectWallet(startupMode: boolean) {
    this.connect(() => {
      // Connected
      this.userAddress = this.state.address;
      this.refreshDisplay();
    }, () => {
      // Not connected
    }, startupMode);
  }

  openDepositDetails(deposit: Deposit) {
    this.selectedDeposit = deposit;
  }

  async openDepositActionModal() {
    const abi = require('../../assets/abi/ERC20.json');
    const contract = new this.web3.eth.Contract(abi, this.DAI_ADDR);
    if (this.userAddress) {
      // User logged into wallet, update balance
      this.depositActionUserBalance = new BigNumber(await contract.methods.balanceOf(this.userAddress).call()).div(this.PRECISION);
    } else {
      // Not logged in, set balance to 0
      this.depositActionUserBalance = new BigNumber(0);
    }

    // Update displayed APY and interest
    this.onDepositActionDepositPeriodChange(this.depositActionLockPeriod);
    this.onDepositActionAmountChange(this.depositActionAmount);
  }

  deposit() {
    if (!this.userAddress) {
      // User not logged in, connect wallet
      this.connect(() => {
        // Connected
        this.userAddress = this.state.address;
        this.refreshDisplay();
        // Make deposit
        this._deposit();
      }, () => {
        // Not connected
      }, false);
      return;
    }
    this._deposit();
  }

  _deposit() {
    const SECOND = 1;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    const poolAbi = require('../../assets/abi/DInterest.json');
    const poolContract = new this.web3.eth.Contract(poolAbi, this.bestPool);
    const tokenAbi = require('../../assets/abi/ERC20.json');
    const tokenContract = new this.web3.eth.Contract(tokenAbi, this.DAI_ADDR);

    const depositAmount = this.depositActionAmount.times(this.PRECISION).integerValue().toFixed();
    const maturationTimestamp = this.depositActionLockPeriod.times(DAY).plus(new BigNumber(Date.now()).div(1e3)).integerValue().toFixed();
    this.sendTxWithToken(poolContract.methods.deposit(depositAmount, maturationTimestamp), tokenContract, this.bestPool, depositAmount, 1e6, (hash) => { this.openConfirmationModal(true, hash); }, () => { this.refreshDisplay(); }, console.log);
  }

  openConfirmationModal(isDeposit, hash) {
    this.txHash = hash;
    this.confirmationIsDeposit = isDeposit;
    $('#modalConfirmation').modal('show');
    $('#modalDeposit').modal('hide');
    $('#modalWithdraw').modal('hide');
    $('#modalDepositDetails').modal('hide');
    $('#modalEarlyWithdraw').modal('hide');
  }

  openWithdrawActionModal() {
    // Generate list of unlocked deposits
    const unlockedDeposits = this.userDeposits.filter((deposit) => this.now >= deposit.maturationTimestamp);

    // Calculate total withdrawable amount
    let withdrawableAmount = new BigNumber(0);
    for (const deposit of unlockedDeposits) {
      withdrawableAmount = withdrawableAmount.plus(deposit.amount);
    }
    this.withdrawActionAmount = withdrawableAmount;
  }

  withdraw() {
    // Generate list of unlocked deposits
    const unlockedDeposits = this.userDeposits.filter((deposit) => this.now >= deposit.maturationTimestamp);
    const unlockedDepositsByPool = {};
    for (const d of unlockedDeposits) {
      if (!unlockedDepositsByPool[d.pool]) unlockedDepositsByPool[d.pool] = [];
      unlockedDepositsByPool[d.pool].push(d);
    }
    const unlockedPools = Object.keys(unlockedDepositsByPool);
    const poolAbi = require('../../assets/abi/DInterest.json');

    for (const pool of unlockedPools) {
      const poolContract = new this.web3.eth.Contract(poolAbi, pool);

      // Convert unlocked deposits into format accepted by contract
      const depositIDList = unlockedDepositsByPool[pool].map((deposit) => deposit.idx.toFixed());
      this.sendTx(poolContract.methods.multiWithdraw(depositIDList), (hash) => { this.openConfirmationModal(false, hash); }, () => { this.refreshDisplay(); }, console.log);
    }
  }

  async openEarlyWithdrawModal() {
    const abi = require('../../assets/abi/ERC20.json');
    const contract = new this.web3.eth.Contract(abi, this.DAI_ADDR);
    this.earlyWithdrawActionUserBalance = new BigNumber(await contract.methods.balanceOf(this.userAddress).call()).div(this.PRECISION);
  }

  async earlyWithdraw() {
    const poolAbi = require('../../assets/abi/DInterest.json');
    const poolContract = new this.web3.eth.Contract(poolAbi, this.selectedDeposit.pool);
    const tokenAbi = require('../../assets/abi/ERC20.json');
    const tokenContract = new this.web3.eth.Contract(tokenAbi, this.DAI_ADDR);

    const penaltyAmount = (await poolContract.methods.userDeposits(this.userAddress, this.selectedDeposit.idx.toFixed()).call()).initialDeficit;
    this.sendTxWithToken(poolContract.methods.earlyWithdraw(this.selectedDeposit.idx.toFixed()), tokenContract, this.selectedDeposit.pool, penaltyAmount, 1e6, (hash) => { this.openConfirmationModal(false, hash); }, () => { this.refreshDisplay(); }, console.log);
  }

  onDepositActionAmountChange(newValue) {
    this.depositActionAmount = new BigNumber(newValue);
    if (this.depositActionAmount.isNaN()) {
      this.depositActionAmount = new BigNumber(0);
    }
    this.updateDepositActionInfo();
  }

  onDepositActionDepositPeriodChange(newValue) {
    this.depositActionLockPeriod = new BigNumber(newValue);
    if (this.depositActionLockPeriod.isNaN()) {
      this.depositActionLockPeriod = new BigNumber(0);
    }
    this.updateDepositActionInfo();
  }

  updateDepositActionInfo() {
    const SECOND = 1;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    // Update upfront interest APY
    const upfrontInterestRate = this.calcUpfrontInterestRate(this.depositActionLockPeriod.times(DAY));
    const dummyDeposit = {
      idx: new BigNumber(0),
      pool: '',
      amount: new BigNumber(1),
      maturationTimestamp: new Date(this.depositActionLockPeriod.times(DAY).times(1e3).plus(Date.now()).toNumber()),
      interestEarned: upfrontInterestRate,
      depositTimestamp: this.now,
      canEarlyWithdraw: true
    } as Deposit
    this.depositActionAPY = this.calcDepositAPY(dummyDeposit);

    // Update upfront interest amount
    this.depositActionInterest = upfrontInterestRate.times(this.depositActionAmount);

    // Check for NaN
    if (this.depositActionAPY.isNaN()) {
      this.depositActionAPY = new BigNumber(0);
    }
    if (this.depositActionInterest.isNaN()) {
      this.depositActionInterest = new BigNumber(0);
    }
  }

  getTimeDifferenceString(futureDate: Date, pastDate: Date): string {
    const SECOND = 1000; // 1s = 1000ms
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    const diff = futureDate.getTime() - pastDate.getTime();
    const diffDay = Math.floor(diff / DAY);
    const diffHour = Math.floor(diff % DAY / HOUR);
    const diffMinute = Math.floor(diff % HOUR / MINUTE);
    const diffSecond = Math.floor(diff % MINUTE / SECOND);

    return `${diffDay}d ${diffHour}h ${diffMinute}m ${diffSecond}s`;
  }

  getTimeDifferenceDays(futureDate: Date, pastDate: Date): number {
    const SECOND = 1000; // 1s = 1000ms
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    const diff = futureDate.getTime() - pastDate.getTime();
    const diffDay = Math.floor(diff / DAY);

    return diffDay;
  }

  getDepositPoolName(deposit: Deposit): string {
    const poolAddr = deposit.pool;
    for (const poolID of Object.keys(this.POOLS)) {
      const pool = this.POOLS[poolID];
      if (poolAddr === pool.address) {
        return pool.name;
      }
    }
    return 'Unknown';
  }

  calcDepositAPY(deposit: Deposit): BigNumber {
    const YEAR = 31556952; // One year in seconds
    const depositLengthInSeconds = new BigNumber(deposit.maturationTimestamp.getTime() - deposit.depositTimestamp.getTime()).div(1e3);
    const interestRatePerSecond = deposit.interestEarned.div(deposit.amount).div(depositLengthInSeconds);
    return interestRatePerSecond.times(YEAR).times(100); // In percent
  }

  calcUpfrontInterestRate(depositPeriodInSeconds: BigNumber): BigNumber {
    const YEAR = 31556952; // One year in seconds
    const ONE = new BigNumber(1);
    const oneYearInterestRate = this.unapplyFee(this.oneYearInterestRate.div(100));
    const moneyMarketInterestRatePerSecond = oneYearInterestRate.div(this.UIRMultiplier.times(ONE.minus(oneYearInterestRate))).div(YEAR);
    const rawUpfrontInterestRate = ONE.minus(ONE.div(ONE.plus(this.UIRMultiplier.times(moneyMarketInterestRatePerSecond).times(depositPeriodInSeconds))));
    return this.applyFee(rawUpfrontInterestRate);
  }

  applyFee(amount) {
    const ONE = new BigNumber(1);
    return ONE.minus(this.FEE).times(amount);
  }

  unapplyFee(amount) {
    const ONE = new BigNumber(1);
    return new BigNumber(amount).div(ONE.minus(this.FEE));
  }
}

class Deposit {
  idx: BigNumber;
  pool: string;
  amount: BigNumber;
  maturationTimestamp: Date;
  interestEarned: BigNumber;
  depositTimestamp: Date;
  canEarlyWithdraw: boolean;
}