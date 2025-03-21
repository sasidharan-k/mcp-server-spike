import { Client } from '@opensearch-project/opensearch';
import { AzureOpenAIEmbeddingProcessor } from './embeddingProcessor.js';
import { SearchResult, VectorSearchConfig } from '../../interface/vectorInterface.js';

const DEFAULT_BATCH_SIZE = 100;

const getTenantIndex = (
  indexPrefix: string,
  hostname: string
): string => {
  if (!indexPrefix || !hostname) {
    throw new Error('Index prefix and hostname are required');
  }
  const normalizedHostname = hostname.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const sanitizedHostname = normalizedHostname
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return `${indexPrefix}-${sanitizedHostname}`;
};

export class VectorSearch {
  private batchSize: number;
  private embeddingProcessor: AzureOpenAIEmbeddingProcessor;
  private indexPrefix: string;
  private vectorDBclient: Client;

  constructor(config: VectorSearchConfig) {
    this.vectorDBclient = config.openSearchClient;
    this.embeddingProcessor = new AzureOpenAIEmbeddingProcessor(
      config.azureOpenAIConfig
    );
    this.indexPrefix = config.indexPrefix;
    this.batchSize = config.batchSize || DEFAULT_BATCH_SIZE;
  }

  async search(
    query: string,
    hostname: string,
    k: number = 5,
    threshold: number = 0.4
  ): Promise<SearchResult[]> {
    console.log(
      `[VectorSearch] Starting KNN search for query: "${query}" in hostname: ${hostname} with k=${k} and threshold=${threshold}`
    );
    const indexName = getTenantIndex(this.indexPrefix, hostname);
    const indexExists = await this.vectorDBclient.indices.exists({
      index: indexName,
    });
    if (!indexExists.body) {
      console.log(`[VectorSearch] No index found for hostname: ${hostname}`);
      throw new Error(`No index found for hostname: ${hostname}`);
    }

    const [queryEmbedding] = await this.embeddingProcessor.processBatch([
      query,
    ]);
    this.embeddingProcessor.validateEmbedding(queryEmbedding);

    const queryMagnitude = Math.sqrt(
      queryEmbedding.reduce((sum, val) => sum + val * val, 0)
    );
    console.log('[VectorSearch] Query vector stats:', {
      length: queryEmbedding.length,
      magnitude: queryMagnitude,
      sample: queryEmbedding.slice(0, 5),
    });

    try {
      console.log(
        '[VectorSearch] Executing KNN search with threshold filtering'
      );
      const adjustedK = Math.min(Math.ceil(k * 3), 100);
      const searchResponse = await this.vectorDBclient.search({
        index: indexName,
        body: {
          size: adjustedK,
          query: {
            bool: {
              must: [
                { term: { 'metadata.hostname': hostname } },
                {
                  knn: {
                    embedding: {
                      vector: Array.from(queryEmbedding),
                      k: adjustedK,
                    },
                  },
                },
              ],
            },
          },
        },
      });

      const hits = searchResponse.body.hits.hits;
      console.log(
        `[VectorSearch] Found ${hits.length} initial results before filtering`
      );

      const results = hits
        .map(
          (hit: any): SearchResult => ({
            document: {
              id: hit._id,
              content: hit._source.content || '',
              metadata: hit._source.metadata || { hostname },
            },
            score: hit._score || 0,
          })
        )
        .filter((result: SearchResult) => result.score >= threshold)
        .slice(0, k);

      console.log(
        `[VectorSearch] After filtering: ${results.length} results met threshold ${threshold}`
      );
      return results;
    } catch (error) {
      console.error('[VectorSearch] Search error:', error);
      throw error;
    }
  }

  async bulkSearch(
    queries: {
      query: string;
      hostname: string;
      k?: number;
      threshold?: number;
    }[]
  ): Promise<SearchResult[][]> {
    const msearchBody: any[] = [];
    for (const { query, hostname, k = 5, threshold = 0.4 } of queries) {
      const indexName = getTenantIndex(this.indexPrefix, hostname);
      const [queryEmbedding] = await this.embeddingProcessor.processBatch([
        query,
      ]);
      this.embeddingProcessor.validateEmbedding(queryEmbedding);
      const adjustedK = Math.min(Math.ceil(k * 3), 100);
      msearchBody.push({ index: indexName });
      msearchBody.push({
        size: adjustedK,
        query: {
          bool: {
            must: [
              { term: { 'metadata.hostname': hostname } },
              {
                knn: {
                  embedding: {
                    vector: Array.from(queryEmbedding),
                    k: adjustedK,
                  },
                },
              },
            ],
          },
        },
      });
    }
    try {
      const response = await this.vectorDBclient.msearch({ body: msearchBody });
      return response.body.responses.map((searchResponse: any, i: number) => {
        const { hostname, k = 5, threshold = 0.4 } = queries[i];
        return searchResponse.hits.hits
          .map(
            (hit: any): SearchResult => ({
              document: {
                id: hit._id,
                content: hit._source.content || '',
                metadata: hit._source.metadata || { hostname },
              },
              score: hit._score || 0,
            })
          )
          .filter((result: SearchResult) => result.score >= threshold)
          .slice(0, k);
      });
    } catch (error) {
      console.error('[VectorSearch] Bulk search error:', error);
      throw error;
    }
  }
}
