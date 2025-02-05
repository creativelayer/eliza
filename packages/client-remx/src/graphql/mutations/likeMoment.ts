import { gql } from "graphql-request"
export const TOGGLE_REACTION = gql`
  mutation ToggleReaction($input: ToggleReactionInput!) {
    toggleReaction(input: $input)
  }
`
