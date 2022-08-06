import { StatefullExportSettings } from 'statefull-api/dist/types';

export interface StatfullApiDetermineOptions {
    protocolOverwrite?: "http:" | "https" | undefined
    hostnameOverwrite?: string | undefined
    portOverwrite?: number | undefined
    basePathOverwrite?: string | undefined
}

export function determineStatfullApi(
    options?: StatfullApiDetermineOptions
): string {
    let basePath = (
        options?.basePathOverwrite ??
        window.location.pathname
    )
    while (
        basePath.startsWith("/") ||
        basePath.startsWith(" ")
    ) {
        basePath = basePath.substring(1)
    }
    while (
        basePath.endsWith("/") ||
        basePath.startsWith(" ")
    ) {
        basePath = basePath.slice(0, -1)
    }
    return (
        options?.protocolOverwrite ??
        window.location.protocol
    ) + "//" + (
            options?.hostnameOverwrite ??
            window.location.hostname
        ) + ":" + (
            options?.portOverwrite ??
            window.location.port
        ) + "/" + basePath
}
