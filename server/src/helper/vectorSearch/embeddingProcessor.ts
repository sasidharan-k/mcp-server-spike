import axios from 'axios';

interface AzureOpenAIConfig {
  apiKey: string;
  apiVersion: string;
  deployment: string;
  endpoint: string;
}

interface BatchProcessor<T, R> {
  processBatch(items: T[], options?: any): Promise<R[]>;
}

export class AzureOpenAIEmbeddingProcessor
  implements BatchProcessor<string, number[]>
{
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly batchSize: number = 8;
  private readonly deployment: string;
  private readonly endpoint: string;
  private readonly VECTOR_DIM = 3072;

  constructor(private readonly config: AzureOpenAIConfig) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.deployment =
      process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT_NAME || config.deployment;
    this.apiVersion =
      process.env.AZURE_OPENAI_EMBEDDINGS_API_VERSION || config.apiVersion;
  }

  getBatchSize(): number {
    return this.batchSize;
  }

  getVectorDimension(): number {
    return this.VECTOR_DIM;
  }

  private async processChunk(texts: string[]): Promise<number[][]> {
    const url = `${this.endpoint}/openai/deployments/${this.deployment}/embeddings?api-version=${this.apiVersion}`;
    const response = await axios.post(
      url,
      { input: texts },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
      }
    );
    return response.data.data.map((item: any) => item.embedding);
  }

  async processBatch(texts: string[]): Promise<number[][]> {
    try {
      const embeddings: number[][] = [];
      for (let i = 0; i < texts.length; i += this.batchSize) {
        const chunk = texts.slice(i, i + this.batchSize);
        const chunkEmbeddings = await this.processChunk(chunk);
        embeddings.push(...chunkEmbeddings);
      }
      return embeddings;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      throw new Error('Failed to generate embeddings from Azure OpenAI');
    }
  }

  validateEmbedding(embedding: number[]): void {
    if (!Array.isArray(embedding)) {
      throw new Error('Embedding must be an array');
    }
    if (embedding.length !== this.VECTOR_DIM) {
      throw new Error(`Invalid embedding dimension: ${embedding.length}`);
    }
    if (embedding.some(val => typeof val !== 'number' || isNaN(val))) {
      throw new Error('Embedding contains invalid values');
    }
    const magnitude = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0)
    );
    if (magnitude < 0.1 || magnitude > 100) {
      throw new Error(`Unusual embedding magnitude: ${magnitude}`);
    }
    if (magnitude === 0) {
      throw new Error('Zero vector detected');
    }
  }
}
