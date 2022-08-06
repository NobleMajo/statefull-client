import { JsonObject } from './json';
import StatefullClient from './index';
import { codeClose } from './websocket';

export class StatefullWebSocket {
    public static readonly STATEFULL_NORMAL_CLOSE: number = 3000
    public static readonly STATEFULL_PROTOCOL_PROBLEM: number = 3001
    public static readonly STATEFULL_ERROR: number = 3002
    public static readonly STATEFULL_ALLOCATE_NODE: number = 3003
    public static readonly STATEFULL_KICK: number = 3004
    public static readonly STATEFULL_BAN: number = 3005

    public originWs: WebSocket
    public initPromise: Promise<JsonObject>

    constructor(
        public readonly client: StatefullClient
    ) {
        this.initPromise = new Promise<JsonObject>(async (res, rej) => {
            this.client.settings.onDebug && await this.client.settings.onDebug(
                this.client,
                "StatefullWebSocket",
                "info",
                "Connect websocket to '" + this.client.nodeUrl + "'..."
            )
            let connectTimeout: any
            this.originWs = new WebSocket(client.nodeUrl)
            this.originWs.onopen = async (event) => {
                this.originWs.send(
                    client.sfSettings.jwtRequestPrefix +
                    localStorage.getItem("JwtSession")
                )
                this.client.settings.onDebug && await this.client.settings.onDebug(
                    this.client,
                    "StatefullWebSocket",
                    "info",
                    "Init message sent!"
                )
                connectTimeout = setTimeout(async () => {
                    this.close(
                        StatefullWebSocket.STATEFULL_PROTOCOL_PROBLEM,
                        "Connect timeout, wait for first message"
                    )
                    const errMessage = "Websocket timeout, no init message received"
                    this.client.settings.onDebug && await this.client.settings.onDebug(
                        this.client,
                        "StatefullWebSocket",
                        "error",
                        errMessage
                    )
                    rej(new Error(errMessage))
                }, client.settings.initWsTimeoutMillis)
            }
            this.originWs.onmessage = async (event) => {
                clearTimeout(connectTimeout)
                let msg: string
                let rawData: string
                let data: any
                try {
                    let msg = event.data
                    if (!msg.startsWith(client.sfSettings.jwtResponsePrefix)) {
                        rej(new Error(
                            "Wrong init message prefix, expect '" +
                            client.sfSettings.jwtResponsePrefix + "':\n" +
                            msg
                        ))
                        return
                    }
                    rawData = msg.substring(client.sfSettings.jwtResponsePrefix.length)
                    data = JSON.parse(rawData)
                    if (typeof data !== "object") {
                        rej(new Error("Received json value is not an object"))
                        return
                    }
                    res(data)
                } catch (err) {
                    this.close(
                        StatefullWebSocket.STATEFULL_PROTOCOL_PROBLEM,
                        "First message is not a json object"
                    )
                    this.client.settings.onDebug && await this.client.settings.onDebug(
                        this.client,
                        "StatefullWebSocket",
                        "error",
                        "Error on parse init message: ", event.data, msg, rawData, data
                    )
                    rej(new Error(
                        "Error on parse init message:\n" + (
                            typeof event.data !== "string" ?
                                JSON.stringify(event.data, null, 2) :
                                event.data
                        ) + "\n" +
                        err.stack
                    ))
                }
            }
            this.originWs.onclose = async (event) => {
                clearTimeout(connectTimeout)
                if (event.code === StatefullWebSocket.STATEFULL_BAN) {
                    let reason: string = "" + event.reason
                    if (reason.startsWith("STATEFULL_BAN")) {
                        reason = reason.substring(13)
                    }
                    while (
                        reason.startsWith(":") ||
                        reason.startsWith(" ") ||
                        reason.startsWith("\n")
                    ) {
                        reason = reason.substring(1)
                    }
                    while (
                        reason.endsWith(":") ||
                        reason.endsWith(" ") ||
                        reason.endsWith("\n")
                    ) {
                        reason = reason.slice(0, -1)
                    }
                    let banTime: number = Number(reason)
                    if (
                        isNaN(banTime) ||
                        banTime < -1
                    ) {
                        banTime = -1
                    }
                    localStorage.setItem(btoa("STATEFULL_BAN"), btoa("" + (Date.now() + banTime)))
                    window.location.reload()
                    return
                }
                this.client.settings.onDebug && await this.client.settings.onDebug(
                    this.client,
                    "StatefullWebSocket",
                    "info",
                    "Connection closed"
                )
                rej(new Error("Connection closed:\n" + JSON.stringify({
                    wasClean: event.wasClean,
                    code: event.code,
                    reason: event.reason,
                })))
            }
            this.originWs.onerror = async (err: Error | any) => {
                clearTimeout(connectTimeout)
                this.close(
                    StatefullWebSocket.STATEFULL_ERROR,
                    "Unexpected error"
                )
                this.client.settings.onDebug && await this.client.settings.onDebug(
                    this.client,
                    "StatefullWebSocket",
                    "error",
                    "Unexpected error:\n" + err.stack
                )
                rej(new Error("Unexpected error:\n" + err.stack))
            }
        })
    }

    send(obj: JsonObject): void {
        this.originWs.send(
            JSON.stringify(obj)
        )
    }

    isConnected(): boolean {
        return this.originWs.readyState === WebSocket.OPEN ||
            this.originWs.readyState === WebSocket.CONNECTING
    }

    close(
        code?: number,
        reason?: string,
    ) {
        if (
            this.originWs.readyState === WebSocket.OPEN ||
            this.originWs.readyState === WebSocket.CONNECTING
        ) {
            this.originWs.close(code, reason)
        }
    }


    normalClose(
        reason?: string,
    ) {
        this.close(
            StatefullWebSocket.STATEFULL_NORMAL_CLOSE,
            "STATEFULL_NORMAL_CLOSE" + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }

    protocolErrorClose(
        reason?: string,
    ) {
        this.close(
            StatefullWebSocket.STATEFULL_PROTOCOL_PROBLEM,
            "STATEFULL_PROTOCOL_PROBLEM" + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }

    errorClose(
        reason?: string,
    ) {
        this.close(
            StatefullWebSocket.STATEFULL_ERROR,
            "STATEFULL_ERROR" + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }

    kick(
        reason?: string,
    ) {
        this.close(
            StatefullWebSocket.STATEFULL_KICK,
            "STATEFULL_KICK" + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }

    ban(
        time: number,
        reason?: string,
    ) {
        if (
            isNaN(time) ||
            time < -1
        ) {
            time = -1
        }
        this.close(
            StatefullWebSocket.STATEFULL_BAN,
            "STATEFULL_BAN:" + time + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }
}
