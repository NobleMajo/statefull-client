export type JsonBaseType = string | number | boolean | null
export type JsonType = JsonHolder | JsonBaseType
export type JsonHolder = JsonObject | JsonType[]
export interface JsonObject {
    [key: string]: JsonType
}