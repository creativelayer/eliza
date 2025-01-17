import { gql } from 'graphql-request'

/**

Relevant schema:

query  getBalances(input:GetBalancesInput): GetBalancesResult!

input GetBalancesInput {
  id: ID!
  chainId: Int
}

type GetBalancesResult {
  balances: [ Balance! ]!
}

type Balance {
  chainId: Int!
  balance: Float!
}

*/
export const GET_BALANCES = gql`
query GetBalances($input: GetBalancesInput!) {
    getBalances(input: $input) {
        balances {
            chainId
            balance
        }
    }
}
`
