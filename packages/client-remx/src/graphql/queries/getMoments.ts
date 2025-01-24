import { gql } from 'graphql-request';

export const GET_MOMENTS = gql`
query GetMoments($input: GetMomentsInput!) {
  getMoments(input: $input) {
    moments {
        community {
            account {
                id
                profile {
                    username
                    displayName
                    bio
                    isFollowing
                    twitterUsername
                    verifiedType
                }
            }
        }
        benefit {
            id
            title
            description
            metadata
            categories
            reaction
        }
        collection {
            metadata
            auction {
                saleDate
            }
        }
    }
    cursor
  }
}

`