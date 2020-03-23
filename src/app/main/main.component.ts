import { Component, OnInit, Inject } from '@angular/core';

import { WEB3 } from '../web3';

import { ApolloAndWeb3Enabled } from '../apolloAndWeb3';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import BigNumber from 'bignumber.js';

@Component({
  selector: 'app-main',
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.css']
})
export class MainComponent extends ApolloAndWeb3Enabled implements OnInit {
  POOL_ADDR = "0x9b226970cdeada0026aed50d02e4a0dd37c92b6f";

  now: Date;

  oneYearInterestRate: BigNumber;
  totalActiveDeposit: BigNumber;
  totalInterestPaid: BigNumber;
  totalValue: BigNumber;
  numActiveUsers: BigNumber;

  userAddress: string;
  userTotalInterestEarned: BigNumber;
  userTotalActiveDeposit: BigNumber;
  userDeposits: Array<Deposit>;

  selectedDeposit: Deposit;

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

    this.userAddress = null;
    this.userTotalInterestEarned = new BigNumber(0);
    this.userTotalActiveDeposit = new BigNumber(0);
    this.userDeposits = new Array<Deposit>();
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
            dpool(id: "${this.POOL_ADDR}") {
              totalActiveDeposit
              totalHistoricalDeposit
              totalInterestPaid
              numUsers
              numActiveUsers
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
                deposits(first: 1000, where: {active: true}) {
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
      const pool = data.dpool;

      // Pool stats
      this.oneYearInterestRate = new BigNumber(pool.oneYearInterestRate).times(100); // In percent
      this.totalActiveDeposit = new BigNumber(pool.totalActiveDeposit);
      this.totalInterestPaid = new BigNumber(pool.totalInterestPaid);
      this.totalValue = this.totalActiveDeposit.plus(pool.deficit);
      this.numActiveUsers = new BigNumber(pool.numActiveUsers);

      if (data.user) {
        const user = data.user;
        const deposits = user.deposits;

        this.userTotalActiveDeposit = new BigNumber(user.totalActiveDeposit);
        this.userTotalInterestEarned = new BigNumber(user.totalInterestEarned);
        this.userDeposits = deposits.map((rawDeposit) => {
          return {
            amount: new BigNumber(rawDeposit.amount),
            maturationTimestamp: this.toDateObject(rawDeposit.maturationTimestamp),
            interestEarned: new BigNumber(rawDeposit.interestEarned),
            depositTimestamp: this.toDateObject(rawDeposit.depositTimestamp)
          } as Deposit;
        });
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

  calcDepositAPY(deposit: Deposit): BigNumber {
    const YEAR = 31556952; // One year in seconds
    const depositLengthInSeconds = new BigNumber(deposit.maturationTimestamp.getTime() - deposit.depositTimestamp.getTime()).div(1e3);
    const interestRatePerSecond = deposit.interestEarned.div(deposit.amount).div(depositLengthInSeconds);
    return interestRatePerSecond.times(YEAR).times(100); // In percent
  }
}

class Deposit {
  amount: BigNumber;
  maturationTimestamp: Date;
  interestEarned: BigNumber;
  depositTimestamp: Date;
}