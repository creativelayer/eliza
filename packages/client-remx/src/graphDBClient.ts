import neo4j, { Driver, Session, QueryResult, Record } from 'neo4j-driver'

export interface Neo4jAuth {
  NEO4J_URI: string
  NEO4J_USERNAME: string
  NEO4J_PASSWORD: string
}

export class GraphDBClient {
  private readonly driver: Driver
  private isClosed: boolean = false

  constructor(auth: Neo4jAuth) {
    const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = auth

    if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
      throw new Error('Missing required Neo4j credentials')
    }

    console.log("Connecting to GraphDB", {NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD})
    try {
      this.driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD))
      // Verify connection immediately
      this.driver.getServerInfo().catch((err) => {
        console.error(`GraphDB connection error\n${err}\nCause: ${err?.cause}`)
        process.exit(-1)
      })
    } catch (err) {
      console.error(`GraphDB driver creation error\n${err}\nCause: ${err?.cause}`)
      process.exit(-1)
    }
  }

  public async executeQuery(query: string, params: any): Promise<Record[]> {
    if (this.isClosed) {
      throw new Error('Cannot execute query - connection has been closed')
    }

    console.debug(`Executing query ${query.replace(/{{REMX_ENV}}/g, process.env.REMX_ENV)} with params ${JSON.stringify(params)}`)

    let session: Session | null = null

    try {
      session = this.driver.session()
      const result: QueryResult = await session.run(
        query.replace(/{{REMX_ENV}}/g, process.env.REMX_ENV),
        params
      )

      console.debug(`Returning ${result.records.length} records after ${result.summary.resultAvailableAfter} ms`)
      return result.records
    } finally {
      await session?.close()
    }
  }

  public async close(): Promise<void> {
    if (!this.isClosed) {
      await this.driver.close()
      this.isClosed = true
    }
  }
}