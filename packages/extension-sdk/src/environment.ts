/** 通用环境上下文服务 ID。环境/天气 provider 注册，业务 extension 只消费上下文文本。 */
export const ENVIRONMENT_CONTEXT_SERVICE_ID = 'environment.context';

/** 通用天气服务 ID。具体天气 provider 可实现该服务，业务 extension 不直接绑定外部天气 API。 */
export const WEATHER_SERVICE_ID = 'environment.weather';

export interface EnvironmentContextInput {
  query?: string;
  kind?: 'weather' | 'time' | 'location' | 'general' | string;
  location?: string;
  now?: number;
  maxBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface EnvironmentContextResult {
  text: string;
  source?: string;
  raw?: unknown;
}

export interface EnvironmentContextService {
  buildContext(input: EnvironmentContextInput): Promise<EnvironmentContextResult | undefined> | EnvironmentContextResult | undefined;
}

export interface WeatherQueryInput {
  location?: string;
  now?: number;
  metadata?: Record<string, unknown>;
}

export interface WeatherResult {
  text: string;
  location?: string;
  temperatureC?: number;
  condition?: string;
  raw?: unknown;
}

export interface WeatherService {
  getWeather(input?: WeatherQueryInput): Promise<WeatherResult | undefined> | WeatherResult | undefined;
}
