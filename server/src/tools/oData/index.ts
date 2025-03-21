import dotenv from 'dotenv';
import { EntityType } from '../../interface/vectorInterface.js';
import { fetchApiEndpoint, getBearerTokenForOdata } from '../../helper/vectorHelper.js';
dotenv.config();

export interface ODataParams {
  select?: string;
  orderby?: string;
  top?: string;
  apply?: string;
  expand?: string;
  filter?: string;
}

export function buildODataQueryUrl(
  endpoint: string,
  params: ODataParams = {}
): string {
  const queryParts: string[] = [];

  if (params.select) {
    queryParts.push(`$select=${encodeURIComponent(params.select)}`);
  }

  if (params.orderby) {
    queryParts.push(`$orderby=${encodeURIComponent(params.orderby)}`);
  }

  if (params.top) {
    queryParts.push(`$top=${encodeURIComponent(params.top)}`);
  }

  if (params.apply) {
    queryParts.push(`$apply=${encodeURIComponent(params.apply)}`);
  }

  if (params.expand) {
    queryParts.push(`$expand=${encodeURIComponent(params.expand)}`);
  }

  if (params.filter) {
    queryParts.push(`$filter=${encodeURIComponent(params.filter)}`);
  }

  // Join query parts with '&'
  const queryString = queryParts.length ? '?' + queryParts.join('&') : '';

  // Complete URL
  const url = endpoint + queryString;

  return url;
}

export const getFilteredOdataResults = async (url: string) => {
  const { bearer_token } = await getBearerTokenForOdata();
  const result = await fetchApiEndpoint(bearer_token.access_token, url, false);
  return result;
};

export const getProcessRecoveryResults = async (
  entityConfig: EntityType,
  id: string
) => {
  if (!entityConfig || !entityConfig.contextName || !entityConfig.mediaType) {
    return [];
  }
  const { bearer_token } = await getBearerTokenForOdata();
  const { contextName, mediaType, type } = entityConfig;
  const url = `${process.env.MUNIS_PROCESS_DISCOVERY_URL}`;
  const bodyOptions = {
    queries: [
      {
        mediaType: [mediaType],
        dataContext: {
          entities: [
            {
              properties: [
                {
                  name: contextName,
                  value: id,
                },
              ],
            },
          ],
        },
      },
    ],
  };
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer_token.access_token}`,
    },
    body: JSON.stringify(bodyOptions),
  };
  console.log(
    '=== process discovery url ====',
    type,
    url,
    bodyOptions,
    '=== process discovery url ===='
  );
  const response = await fetch(url, requestOptions);
  if (!response.ok) {
    throw new Error('Failed to fetch process discovery results');
  }
  const data = await response.json();
  return data?.results;
};
