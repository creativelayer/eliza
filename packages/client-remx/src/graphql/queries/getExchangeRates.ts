import { gql } from 'graphql-request';

/**
 * Gets eth to usd
 */
export const GET_EXCHANGE_PRICES = gql`
  query GetExchangePrices {
    getExchangePrices {
      eth
      matic
    }
  }
`