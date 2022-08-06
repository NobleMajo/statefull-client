import { StatefullExportSettings } from 'statefull-api/dist/types';

export async function fetchApiSettings(
    url: string,
): Promise<StatefullExportSettings> {
    const resp = await fetch(url + "/statefull.json")
    if (resp.status !== 200) {
        throw new Error(
            "fetchApiSettings(): Status is not 200 on " +
            url + ":\n" +
            resp.status + ": " + resp.statusText + ":\n" +
            await resp.text()
        )
    }
    const data: StatefullExportSettings = await resp.json()
    if (typeof data.externalUrl !== "string") {
        throw new Error(
            "StatefullExportSettings 'externalUrl' is not a string"
        )
    } else if (typeof data.jwtRequestPrefix !== "string") {
        throw new Error(
            "StatefullExportSettings 'jwtRequestPrefix' is not a string"
        )
    } else if (typeof data.nodeHashIterations !== "number") {
        throw new Error(
            "StatefullExportSettings 'nodeHashIterations' is not a number"
        )
    } else if (typeof data.nodeHashAlgorithm !== "string") {
        throw new Error(
            "StatefullExportSettings 'nodeHashAlgorithm' is not a string"
        )
    }
    return data
}

export type StatefullRequestInit = RequestInit & {
    path: string,
    settings: StatefullExportSettings,
}

export async function apiFetch(
    init: StatefullRequestInit,
): Promise<Response> {
    if (!init.path.startsWith("/")) {
        init.path = "/" + init.path
    }
    let token: string = localStorage.getItem("JwtSession")
    if (
        typeof token === "string" &&
        token.length > 0
    ) {
        token = init.settings.jwtRequestPrefix + token
        if (typeof init.headers !== "object") {
            init.headers = {}
        }
        init.headers[init.settings.jwtRequestHeader] = token
    }
    const resp = await fetch(
        init.settings.externalUrl + init.path,
        init
    )
    if (resp.status === 401) {
        localStorage.removeItem("JwtSession")
        window.location.href = init.settings.externalUrl
        process.exit(0)
        return
    }
    const sessionHeader = resp.headers.get(init.settings.jwtResponseHeader)
    if (typeof sessionHeader !== "string") {
        throw new Error(
            "'" + init.settings.jwtResponseHeader +
            "' header is not a set session string"
        )
    } else if (sessionHeader.length === 0) {
        throw new Error(
            "'" + init.settings.jwtResponseHeader +
            "' header is a empty sessions string"
        )
    } else if (!sessionHeader.startsWith(init.settings.jwtResponsePrefix)) {
        throw new Error(
            "'" + init.settings.jwtResponseHeader +
            "' header session string dont starts with prefix '" +
            init.settings.jwtResponsePrefix + "'"
        )
    }
    const sessionToken = sessionHeader.substring(
        init.settings.jwtResponsePrefix.length
    )
    if (sessionToken.length === 0) {
        throw new Error(
            "'" + init.settings.jwtResponseHeader +
            "' header session token is empty"
        )
    }

    localStorage.setItem("JwtSession", sessionToken)
    return resp
}

export async function allocateNode(
    settings: StatefullExportSettings,
): Promise<string> {
    const resp = await apiFetch({
        path: "/browser/allocate",
        settings: settings,
    })
    if (resp.status === 500) {
        throw new Error("Internal server error: " + resp.statusText)
    } else if (resp.status === 404) {
        throw new Error("Wrong endpoint: " + resp.statusText)
    } else if (resp.status === 403) {
        throw new Error("Can't allocate node: " + resp.statusText)
    } else if (resp.status !== 200) {
        throw new Error("Unexpected status code: " + resp.status + ": " + resp.statusText)
    }
    const nodeUrl = await resp.text()
    if (nodeUrl.length === 0) {
        throw new Error("Received node url length is 0")
    }
    return nodeUrl
}
