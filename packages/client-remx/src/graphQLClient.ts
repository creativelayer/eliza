import { GraphQLClient as GQLClient } from 'graphql-request'

export interface GraphQLConfig {
  GRAPHQL_URL: string
  REMX_AGENT_ID: string
}

export class GraphQLClient {
  private readonly baseUrl: string
  private readonly agentId: string
  constructor(config: GraphQLConfig) {
    const { GRAPHQL_URL, REMX_AGENT_ID } = config

    if (!GRAPHQL_URL) {
      throw new Error('Missing required GraphQL URL')
    }

    this.baseUrl = GRAPHQL_URL
    this.agentId = REMX_AGENT_ID
  }

  private createClient(accessToken: string | null): GQLClient {
    const headers: Record<string, string> = {}
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    }
    headers['x-remx-agent'] = this.agentId

    return new GQLClient(this.baseUrl, { headers })
  }

  public async request<T = any>(
    query: string,
    variables: Record<string, any> = {},
    accessToken: string | null = null
  ): Promise<T> {
    try {
      const client = this.createClient(accessToken)
      const response = await client.request<T>(query, variables)
      return response
    } catch (error) {
      console.error(`[REMX] Error in graphQLRequest`, error)
      throw error
    }
  }
}