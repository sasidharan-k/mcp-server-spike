import { formatAlert, makeNWSRequest } from "../helper/helper.js";
import { AlertsResponse, ForecastResponse, PointsResponse } from "../interface/interface.js";

export const NWS_API_BASE = "https://api.weather.gov";

const weatherToolConfig = [
    {
        name: "get_alerts",
        description: "Get weather alerts for a state",
        parameters: {
            type: 'object',
            properties: {
                state: {
                    type: 'string',
                    description:
                        'Two-letter state code (e.g. CA, NY)',
                },
            }
        },
        function: async ({ state }: { state: string }) => {
            const stateCode = state.toUpperCase();
            const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
            const alertsData: AlertsResponse | null = await makeNWSRequest(alertsUrl);

            if (!alertsData) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Failed to retrieve alerts data",
                        },
                    ],
                };
            }

            const features = alertsData.features || [];
            if (features.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No active alerts for ${stateCode}`,
                        },
                    ],
                };
            }

            const formattedAlerts = features.map(formatAlert);
            const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;

            return {
                content: [
                    {
                        type: "text",
                        text: alertsText,
                    },
                ],
            };
        }
    },
    {
        name: "get_forecast",
        description: "Get weather forecast for a location",
        parameters: {
            type: 'object',
            properties: {
                latitude: {
                    type: 'number',
                    description:
                        'Latitude of the location',
                },
                longitude: {
                    type: 'number',
                    description:
                        'Longitude of the location',
                },
            }
        },
        function: async ({ latitude, longitude }: { latitude: number, longitude: number }) => {
            // Get grid point data
            const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
            const pointsData: PointsResponse | null = await makeNWSRequest(pointsUrl);

            if (!pointsData) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
                        },
                    ],
                };
            }

            const forecastUrl = pointsData.properties?.forecast;
            if (!forecastUrl) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Failed to get forecast URL from grid point data",
                        },
                    ],
                };
            }

            // Get forecast data
            const forecastData: ForecastResponse | null = await makeNWSRequest(forecastUrl);
            if (!forecastData) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Failed to retrieve forecast data",
                        },
                    ],
                };
            }

            const periods = forecastData.properties?.periods || [];
            if (periods.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "No forecast periods available",
                        },
                    ],
                };
            }

            // Format forecast periods
            const formattedForecast = periods.map((period) =>
                [
                    `${period.name || "Unknown"}:`,
                    `Temperature: ${period.temperature || "Unknown"}°${period.temperatureUnit || "F"}`,
                    `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
                    `${period.shortForecast || "No forecast available"}`,
                    "---",
                ].join("\n"),
            );

            const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;

            return {
                content: [
                    {
                        type: "text",
                        text: forecastText,
                    },
                ],
            };
        }
    }
]

export { weatherToolConfig };