import { Awaitable, StatefullExportSettings } from 'statefull-api/dist/types';

export function determineApiBaseUrl(): string {
    let basePath = window.location.pathname
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
    if (basePath.length != 0) {
        basePath = "/" + basePath
    }
    return window.location.protocol + "//" +
        window.location.hostname + ":" +
        window.location.port +
        basePath
}

export async function fetchApiSettings(
    url: string,
): Promise<StatefullExportSettings> {
    const resp = await fetch(url + "/statefull.json")
    if (resp.status != 200) {
        throw new Error(
            "fetchApiSettings(): Status is not 200 on " +
            url + ":\n" +
            resp.status + ": " + resp.statusText + ":\n" +
            await resp.text()
        )
    }
    const data: StatefullExportSettings = await resp.json()
    if (typeof data.externalUrl != "string") {
        throw new Error(
            "StatefullExportSettings 'externalUrl' is not a string"
        )
    } else if (typeof data.jwtRequestPrefix != "string") {
        throw new Error(
            "StatefullExportSettings 'jwtRequestPrefix' is not a string"
        )
    } else if (typeof data.nodeHashIterations != "number") {
        throw new Error(
            "StatefullExportSettings 'nodeHashIterations' is not a number"
        )
    } else if (typeof data.nodeHashAlgorithm != "string") {
        throw new Error(
            "StatefullExportSettings 'nodeHashAlgorithm' is not a string"
        )
    }
    return data
}

export async function apiFetch(
    settings: StatefullExportSettings,
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    if (!path.startsWith("/")) {
        path = "/" + path
    }
    if (typeof init != "object") {
        init = {}
    }
    let token: string = localStorage.getItem("JwtSession")
    if (
        typeof token == "string" &&
        token.length > 0
    ) {
        token = settings.jwtRequestPrefix + token
        if (
            typeof init.headers != "object"
        ) {
            init.headers = {
                [settings.jwtRequestHeader]: token
            }
        } else {
            init.headers[settings.jwtRequestHeader] = token
        }
    }
    const resp = await fetch(
        settings.externalUrl + path,
        init
    )
    const sessionHeader = resp.headers.get(settings.jwtResponseHeader)
    if (typeof sessionHeader != "string") {
        throw new Error(
            "'" + settings.jwtResponseHeader +
            "' header is not a set session string"
        )
    } else if (sessionHeader.length == 0) {
        throw new Error(
            "'" + settings.jwtResponseHeader +
            "' header is a empty sessions string"
        )
    } else if (!sessionHeader.startsWith(settings.jwtResponsePrefix)) {
        throw new Error(
            "'" + settings.jwtResponseHeader +
            "' header session string dont starts with prefix '" +
            settings.jwtResponsePrefix + "'"
        )
    }
    const sessionToken = sessionHeader.substring(settings.jwtResponsePrefix.length)
    if (sessionToken.length == 0) {
        throw new Error(
            "'" + settings.jwtResponseHeader +
            "' header session token is empty"
        )
    }

    localStorage.setItem("JwtSession", sessionToken)
    return resp
}

export async function allocateNode(
    settings: StatefullExportSettings,
): Promise<string> {
    const resp = await apiFetch(
        settings,
        "/browser/allocate"
    )
    if (resp.status == 500) {
        throw new Error("Internal server error: " + resp.statusText)
    } else if (resp.status == 404) {
        throw new Error("Wrong endpoint: " + resp.statusText)
    } else if (resp.status == 403) {
        throw new Error("Can't allocate node: " + resp.statusText)
    } else if (resp.status != 200) {
        throw new Error("Unexpected status code: " + resp.status + ": " + resp.statusText)
    }
    return await resp.text()
}

export type StatefullReadyCallback = (
    sock: WebSocket,
    initMsg: string,
    settings: StatefullExportSettings,
    nodeUrl: string,
) => Awaitable<void>

export async function connectStatefull(
    callback: StatefullReadyCallback,
): Promise<void> {
    try {
        const settings = await fetchApiSettings(
            (
                await fetchApiSettings(
                    determineApiBaseUrl()
                )
            ).externalUrl
        )
        const nodeUrl = await allocateNode(settings)
        let timeout: any
        let sock: WebSocket
        const initMsg = await new Promise<string>((res, rej) => {
            sock = new WebSocket(nodeUrl)
            sock.onopen = async function (event) {
                console.info("[Statefull] connected, send token...")
                sock.send(settings.jwtRequestPrefix + localStorage.getItem("JwtSession"))
                timeout = setTimeout(() => {
                    try {
                        sock.close()
                    } catch (err) { }
                    rej(new Error(
                        "[Statefull] No init message received"
                    ))
                    return
                }, 1000 * 5)
            }
            sock.onmessage = async function (event) {
                try {
                    let msg: string = event.data.toString()
                    if (!msg.startsWith(settings.jwtResponsePrefix)) {
                        rej(new Error(
                            "[Statefull] Wrong init message prefix, expect '" +
                            settings.jwtResponsePrefix + "':\n" +
                            msg
                        ))
                        return
                    }
                    clearTimeout(timeout)
                    res(msg.substring(settings.jwtResponsePrefix.length))
                    return
                } catch (err) {
                    try {
                        sock.close()
                    } catch (err) { }
                    rej(new Error("[Statefull] Error on parse init message:\n" + err.stack))
                }
            }
            sock.onclose = async function (event) {
                rej(new Error("[Statefull] Connection closed:\n" + JSON.stringify({
                    wasClean: event.wasClean,
                    code: event.code,
                    reason: event.reason,
                })))
            }
            sock.onerror = async function (err: Error | any) {
                try {
                    sock.close()
                } catch (err) { }
                rej(new Error("[Statefull] WebSocket error:\n" + err.stack))
            }
        })

        await callback(
            sock,
            initMsg,
            settings,
            nodeUrl,
        )
    } catch (err) {
        throw err
    }
}