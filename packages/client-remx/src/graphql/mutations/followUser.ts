import { gql } from 'graphql-request'

export const FOLLOW_USER = gql`
    mutation follow($id: ID!) {
        follow(id: $id)
    }
`