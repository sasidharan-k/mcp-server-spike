import { Client } from '@opensearch-project/opensearch';

export interface Document {
    content: string;
    embedding?: number[];
    id: string;
    metadata: {
        hostname: string;
        [key: string]: any;
    };
}

export interface SearchResult {
    document: Document;
    score: number;
}

export interface AzureOpenAIConfig {
    apiKey: string;
    apiVersion: string;
    deployment: string;
    endpoint: string;
}

export interface ChunkingStrategy {
    chunkSize?: number;
    overlap?: number;
    splitText(text: string): string[];
}

export interface ContextStrategy {
    generateContext(document: string, chunk: string): Promise<string>;
}

export interface VectorSearchConfig {
    azureOpenAIConfig: AzureOpenAIConfig;
    batchSize?: number;
    chunkingOptions?: {
        chunkSize?: number;
        maxChunkSize?: number;
        minChunkSize?: number;
        overlap?: number;
    };
    chunkingStrategy?: ChunkingStrategy;
    contextStrategy?: ContextStrategy;
    indexPrefix: string;
    openSearchClient: Client;
    similarityMetric?: 'cosine' | 'dot_product' | 'l2_norm';
}

export type EntityType = {
    type: string;
    endpoint: string;
    mediaType: string;
    schemaEntityName: string;
    primaryKey: string;
    contextName: string;
};