
import neo4j from 'neo4j-driver'
import { GraphQLClient } from 'graphql-request'
import { getState } from './state'

let driver

export const getDriver = async () => {
  if (!driver) {
    const URI = process.env.NEO4J_URI
    const USER = process.env.NEO4J_USER
    const PASSWORD = process.env.NEO4J_PASSWORD
    try {
      driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
      await driver.getServerInfo()
    } catch (err) {
      console.error(`GraphDB connection error\n${err}\nCause: ${err.cause}`)
      process.exit(-1)
    }
  }
  return driver
}

export const executeQuery = async (query, params = {}) => {
  console.debug(`Executing query ${query.replace(/{{REMX_ENV}}/g, process.env.REMX_ENV)} with params ${JSON.stringify(params)}`)

  const driver = await getDriver()

  const session = driver.session()
  const { records, summary } = await session.run(query.replace(/{{REMX_ENV}}/g, process.env.REMX_ENV), params)
  session.close()

  console.debug(`Returning ${records.length} records after ${summary.resultAvailableAfter} ms`)
  return records
}

export const getGraphQLClient = (remxConfig, accessToken) => {
  const headers = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  const client = new GraphQLClient(remxConfig.GRAPHQL_URL, {
    headers
  })
  return client
}

export const graphQLRequest = async (remxConfig, query, variables) => {
  const state = await getState()
  console.log("[REMX] GraphQL request state", state);
  const client = getGraphQLClient(remxConfig, state?.AccessToken)
  console.log("[REMX] GraphQL request client", client);
  const response = await client.request(query, variables)
  console.log("[REMX] GraphQL request response", response);
  return response
}

