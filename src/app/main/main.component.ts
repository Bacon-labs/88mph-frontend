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

  oneYearInterestRate: BigNumber;
  totalActiveDeposit: BigNumber;
  totalInterestPaid: BigNumber;
  totalValue: BigNumber;
  numActiveUsers: BigNumber;

  userTotalInterestEarned: BigNumber;
  userTotalActiveDeposit: BigNumber;

  constructor(@Inject(WEB3) web3, private apollo: Apollo) {
    super(web3);

    this.oneYearInterestRate = new BigNumber(0);
    this.totalActiveDeposit = new BigNumber(0);
    this.totalInterestPaid = new BigNumber(0);
    this.totalValue = new BigNumber(0);
    this.numActiveUsers = new BigNumber(0);

    this.userTotalInterestEarned = new BigNumber(0);
    this.userTotalActiveDeposit = new BigNumber(0);
  }

  ngOnInit(): void {
    this.createQuery();
  }

  createQuery() {
    const userAddress = this.state ? this.state.address.toLowerCase() : null;
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
            ${userAddress ? 
              `user(id: "${userAddress}") {
                numDeposits
                numActiveDeposits
                totalActiveDeposit
                totalHistoricalDeposit
                totalInterestEarned
                deposits(first: 1000, where: {active: true}) {
                  amount
                  maturationTimestamp
                  interestEarned
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
      console.log(data);
      const pool = data.dpool;

      // Pool stats
      this.oneYearInterestRate = new BigNumber(pool.oneYearInterestRate).times(100);
      this.totalActiveDeposit = new BigNumber(pool.totalActiveDeposit);
      this.totalInterestPaid = new BigNumber(pool.totalInterestPaid);
      this.totalValue = this.totalActiveDeposit.plus(pool.deficit);
      this.numActiveUsers = new BigNumber(pool.numActiveUsers);

      if (data.user) {
        const user = data.user;
      }
    }
  }

  refreshDisplay() {
    this.query.refetch().then((result) => this.handleQuery(result));
  }
}
