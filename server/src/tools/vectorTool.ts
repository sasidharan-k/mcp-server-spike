import dotenv from "dotenv";
import { Client } from '@opensearch-project/opensearch';
import { FixedLengthChunking } from '../helper/chuncking/fixedLengthChunking.js';
import { VectorSearch } from '../helper/vectorSearch/vectorSearch.js';
import { SearchResult } from '../interface/vectorInterface.js';
import { MUNIS_ENTITIES_MAP } from '../helper/entities.js';
import { buildODataQueryUrl, getFilteredOdataResults, getProcessRecoveryResults } from './oData/index.js';
import AzureOpenAI from 'openai';

dotenv.config();

export interface ContextStrategy {
    generateContext(document: string, chunk: string): Promise<string>;
  }
  

export class AISummarizedContextGenerator implements ContextStrategy {
    private client: AzureOpenAI;
  
    constructor(config: { apiKey: string; model?: string }) {
      this.client = new AzureOpenAI({
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}`,
        defaultQuery: {
          'api-version': process.env.AZURE_OPENAI_API_VERSION,
          'api-key': process.env.AZURE_OPENAI_API_KEY,
        },
      });
    }
  
    async generateContext(document: string, chunk: string): Promise<string> {
      const response = await this.client.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!, // Use the deployment name as the model
        messages: [
          {
            role: 'system',
            content:
              'Generate a brief context explaining how this chunk relates to the full document.',
          },
          {
            role: 'user',
            content: `Document: ${document}\n\nChunk: ${chunk}\n\nGenerate concise context to improve search retrieval.`,
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      });
  
      return response.choices[0].message.content || '';
    }
}

const munisVectorToolConfig = [
    {
        name: "getVectorMunisDetailsAgent",
        description: "",
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        'The user query to be used to search in the vector store',
                },
                topK: {
                    type: 'number',
                    description:
                        'Optional: Number of top results to return (default: 5).',
                },
                explanation: {
                    type: 'string',
                    description:
                        'Step-by-step thoughts on whether you think this question is ambiguous and why you think it is ambiguous.',
                },
            },
            required: ['query', 'explanation'],
        },
        function: async (args: string) => {
            const parsedArgs = JSON.parse(args);
            console.log(
                '==== Vector Search Args ====',
                parsedArgs,
                '==== Vector Search Args ===='
            );
            const topK = parsedArgs.topK || 10;
            const threshold = 0.4;
            const hostName = process.env.MUNIS_VECTOR_HOST_NAME || '';
            const { query } = parsedArgs;
            const openSearchClient = new Client({
                node: process.env.OPEN_SEARCH_ENDPOINT,
                auth: {
                    username: process.env.OPEN_SEARCH_USERNAME!,
                    password: process.env.OPEN_SEARCH_PASSWORD!,
                },
            });

            const contextStrategy = new AISummarizedContextGenerator({
                apiKey: process.env.OPENAI_API_KEY!,
                model: process.env.OPENAI_MODEL || 'gpt-4o',
              });

            const chunkingStrategy = new FixedLengthChunking(
                parseInt(process.env.CHUNK_SIZE || '1000'),
                parseInt(process.env.CHUNK_OVERLAP || '200')
            );

            const vectorSearch = new VectorSearch({
                openSearchClient,
                azureOpenAIConfig: {
                    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
                    apiKey: process.env.AZURE_OPENAI_API_KEY!,
                    apiVersion: process.env.AZURE_OPENAI_EMBEDDINGS_API_VERSION!,
                    deployment: process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT_NAME!,
                },
                indexPrefix: process.env.VECTOR_INDEX_PREFIX!,
                similarityMetric: 'cosine',
                batchSize: parseInt(process.env.BATCH_SIZE || '100'),
                chunkingStrategy,
                contextStrategy,
            });

            const result = await vectorSearch.search(query, hostName, topK, threshold);
            console.log('result===>', result)
            const finalMetadata = result.map((res: SearchResult) => {
                return res?.document?.metadata;
            });
            console.log(
                '==== Vector Search Result ====',
                finalMetadata,
                '==== Vector Search Result ===='
            );
            return JSON.stringify({
                "name": "accountId",
                "displayName": "Account Id",
                "primaryKey": true
              });
        }
    },
    // {
    //     name: "get_data_via_OData",
    //     description: "Construct an OData query and get the data for an entity using OData.",
    //     parameters: {
    //         type: 'object',
    //         strict: true,
    //         properties: {
    //             explanation: {
    //                 type: 'string',
    //                 description:
    //                     'A place for you to write your thoughts, step by step, about the right columns to pick. This will help the user understand your reasoning. Remember to include why you picked the primary key you did for filtering! List out all the columns you will use for the OData query. Go back and review the entity schema and ensure the columns exist for this specific entity schema. Do all of these columns exist in the entity schema? If not, try again.',
    //             },
    //             url: {
    //                 type: 'string', //["string", "null"],
    //                 description:
    //                     'The base OData url. For example https://example.com/odata/v1/resources',
    //             },
    //             select: {
    //                 type: 'string', //["string", "null"],
    //                 description:
    //                     '$select parameter in OData. Selects specific columns in the query. You must ensure all columns in the select clause exist in the entity schema',
    //             },
    //             orderby: {
    //                 type: 'string', //["string", "null"],
    //                 description:
    //                     '$orderby parameter in OData. Orders the data by specified columns. You must ensure all columns in the orderby clause exist in the entity schema',
    //             },
    //             top: {
    //                 type: 'string', //["string", "null"],
    //                 description:
    //                     '$top parameter in OData. Selects the top n items. You must ensure all columns in the top clause exist in the entity schema',
    //             },
    //             apply: {
    //                 type: 'string', //["string", "null"],
    //                 description:
    //                     'apply parameter in OData. Allows you to apply aggregation operators like $apply=aggregate($count as TotalAssets) and $apply=aggregate(purchasePrice with average as AveragePurchasePrice). You must ensure all columns in the apply clause exist in the entity schema',
    //             },
    //             expand: {
    //                 type: 'string', //["string", "null"],
    //                 description:
    //                     'expand parameter in OData. OData expand functionality can be used to query related data. For example, to get the Course data for each Enrollment entity, include ?$expand=course at the end of the request path. Expand can be applied to more than one level of navigation property. For example, to get the Department data of each Course for each Enrollment entity, include ?$expand=course($expand=Department) at the end of the request path.  For example: `$expand=purchaseOrderItems($expand=purchaseOrderReceipts($select=receivedDate);$select=lineNumber,itemDescription,quantity)`. You must ensure all columns in the expand clause exist in the entity schema',
    //             },
    //             filter: {
    //                 type: 'string', // ["string", "null"],
    //                 description:
    //                     '$filter parameter in OData. Filters the dataset to a subset of data. Follows the OASIS v4 standards. You must ensure all columns in the filter clause exist in the entity schema',
    //             },
    //             entity_id: {
    //                 type: 'string',
    //                 description:
    //                     'The numeric entity ID to grab training data and schema for the entity. This must be the numeric ID from the search results. The entity ID must be within the range of 1 to 471 - any value outside this range will cause errors.',
    //             },
    //             display_type: {
    //                 type: 'string',
    //                 enum: [
    //                     'final_answer',
    //                     'list_of_records',
    //                     'explore_single_record',
    //                     'interim_step',
    //                 ],
    //                 description:
    //                     'The display type of the answer to the user can be one of four types: #1 is "final_answer" which is just the end value. This is useful when there is an ask for an a sum, a count, average, a date, a total or any single final value. #2 is a "list_of_records" which shows us multiple records. This is used when the user wants to see a set of records or all records. #3 is "explore_single_record" which is used when the user asks for details of a single record. #4 is "interim_step" which has no display and is used for an interim step. This is used for example in a lookup of a primary key in one entity to join to a secondary entity as a foreign key',
    //             },
    //         },
    //         additionalProperties: false,
    //         required: ['explanation', 'entity_id', 'display_type'], //,'url','select','orderby','top','count','filter'],
    //     },
    //     function: async (args: string) => {
    //         const parsedArgs = JSON.parse(args);
    //         console.log(
    //             '==== oData Parsed Args ====',
    //             parsedArgs,
    //             '==== Parsed Args ===='
    //         );
    //         const entityID = JSON.parse(args).entity_id || '';
    //         const entityConfig =
    //             MUNIS_ENTITIES_MAP[entityID as keyof typeof MUNIS_ENTITIES_MAP];

    //         if (!entityConfig) {
    //             console.log('===========> Entity type is undefined');
    //             return '';
    //         }

    //         let baseUrl = process.env.MUNIS_ODATA_URL || '';
    //         baseUrl += '/' + entityConfig.endpoint + entityConfig.type;

    //         const odataParams = {
    //             select: parsedArgs.select ? parsedArgs.select : undefined,
    //             orderby: parsedArgs.orderby ? parsedArgs.orderby : undefined,
    //             top: parsedArgs.top ? parsedArgs.top : undefined,
    //             // count: parsedArgs.count ? parsedArgs.count : undefined,
    //             apply: parsedArgs.apply ? parsedArgs.apply : undefined,
    //             expand: parsedArgs.expand ? parsedArgs.expand : undefined,
    //             filter: parsedArgs.filter ? parsedArgs.filter : undefined,
    //         };
    //         const displayType = parsedArgs.display_type;

    //         // Call the buildODataQueryUrl function to construct the URL
    //         const fullUrl = buildODataQueryUrl(baseUrl, odataParams || {});

    //         console.log(
    //             '==== Query returned by LLM ====',
    //             baseUrl,
    //             fullUrl,
    //             entityID,
    //             '==== Query returned by LLM ===='
    //         );
    //         try {
    //             let filteredData = await getFilteredOdataResults(fullUrl);
    //             if (typeof filteredData === 'string') {
    //                 filteredData = JSON.parse(filteredData);
    //             }
    //             const filteredResults = filteredData.value || filteredData;

    //             console.log('filteredResults', filteredResults);

    //             return JSON.stringify(filteredResults);
    //         } catch (error: any) {
    //             console.log(
    //                 '==== Error inside OData ====',
    //                 JSON.stringify({ ...error, message: error.message }),
    //                 '==== Error inside OData ===='
    //             );
    //             return JSON.stringify({ ...error, message: error.message });
    //         }
    //     }
    // }
]

export default munisVectorToolConfig;