import { gql } from "graphql-request"

export const TIP_ARTIST = gql`
mutation TipArtist($input: TipArtistInput!) {
    tipArtist(input: $input) {
        hash
    }
}
`