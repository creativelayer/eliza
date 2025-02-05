import { gql } from "graphql-request";

/*
Relevant schema:

  getSupportedNetworks: SupportedNetworks!

  type SupportedNetworks {
  defaultChainId: Int!
  chains: [ Chain ]!
}

*/
export const GET_SUPPORTED_NETWORKS = gql`
    query getSupportedNetworks {
        getSupportedNetworks {
            defaultChainId
        }
    }
`