import { gql } from 'graphql-request';

export const GET_PROFILE = gql`
query GetProfile($id: ID!) {
    getProfile(id: $id) {
        id
        accountId
        displayName
        username
        bio
        verified
        isFollowing
        farcasterUsername
        twitterUsername
    }
}
`