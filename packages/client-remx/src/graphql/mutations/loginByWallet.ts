import { gql } from 'graphql-request';

export const LOGIN_BY_WALLET = gql`
mutation LoginByWallet($address: String!, $connectionType: String!) {
  loginByWallet(address: $address, connectionType: $connectionType) {
    id
    defaultWallet
  }
}
`