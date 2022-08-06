import { JsonObject } from './json';
import { Awaitable, StatefullExportSettings } from 'statefull-api/dist/types';
import { determineStatfullApi, StatfullApiDetermineOptions } from './apiDetermine';
import { allocateNode, fetchApiSettings } from './apiFetch';
import { getCloseInfo, WebSocketCloseInfo } from './websocket';
import { StatefullWebSocket } from './StatefullWebSocket';

export type StatefullAllocateCallback = (
    client: StatefullClient,
    reason: string,
) => Awaitable<void>

export type StatefullStartCallback = (
    client: StatefullClient,
) => Awaitable<void>

export type StatefullInitCallback = (
    client: StatefullClient,
    initObj: JsonObject,
) => Awaitable<void>

export type StatefullDisconnectCallback = (
    client: StatefullClient,
    closeInfo: WebSocketCloseInfo,
) => Awaitable<void>

export type StatefullDataCallback = (
    client: StatefullClient,
    data: JsonObject,
) => Awaitable<void>

export type StatefullReconnectCallback = (
    client: StatefullClient,
) => Awaitable<void>

export type StatefullStopCallback = (
    client: StatefullClient,
) => Awaitable<void>

export type StatefullErrorCallback = (
    client: StatefullClient,
    err: Error | any,
) => Awaitable<void>

export type StatefullKickCallback = (
    client: StatefullClient,
    reason: string,
) => Awaitable<void>

export type StatefullBanCallback = (
    client: StatefullClient,
    reason: string,
    endTime: number | -1,
) => Awaitable<void>

export type DebugCallback = (
    client: StatefullClient,
    source: string,
    type: "info" | "warning" | "error" | "location",
    ...messages: any[]
) => Awaitable<void>

export interface StatefullClientOptions {
    verbose?: boolean

    onData: StatefullDataCallback

    onError?: StatefullErrorCallback | undefined
    onInit?: StatefullInitCallback | undefined
    onDisconnect?: StatefullDisconnectCallback | undefined
    onAllocate?: StatefullAllocateCallback | undefined
    onStart?: StatefullStartCallback | undefined
    onReconnect?: StatefullReconnectCallback | undefined
    onStop?: StatefullStopCallback | undefined
    onBan?: StatefullBanCallback | undefined
    onKick?: StatefullKickCallback | undefined

    onDebug?: DebugCallback | undefined

    determineApiTimes?: number | undefined
    determineApi?: string | StatfullApiDetermineOptions | undefined
    determineApiRequestTimeoutMillis?: number | undefined

    nodeConnectTimes?: number,
    nodeConnectTimeoutMillis?: number,

    initWsTimeoutMillis?: number | undefined
}

export interface StatefullClientSettings {
    verbose: boolean

    onData: StatefullDataCallback

    onError: StatefullErrorCallback | undefined
    onInit: StatefullInitCallback | undefined
    onDisconnect: StatefullDisconnectCallback | undefined
    onAllocate: StatefullAllocateCallback | undefined
    onStart: StatefullStartCallback | undefined
    onReconnect: StatefullReconnectCallback | undefined
    onStop: StatefullStopCallback | undefined
    onBan: StatefullBanCallback | undefined
    onKick: StatefullKickCallback | undefined

    onDebug: DebugCallback | undefined

    determineApiTimes: number
    determineApi: string | StatfullApiDetermineOptions | undefined
    determineApiRequestTimeoutMillis: number

    nodeConnectTimes: number,
    nodeConnectTimeoutMillis: number,

    initWsTimeoutMillis: number
}

export const defaultStatefullClientSettings: StatefullClientSettings = {
    verbose: false,

    onError: undefined as any,
    onInit: undefined as any,
    onData: undefined as any,
    onDisconnect: undefined as any,

    onAllocate: undefined,
    onStart: undefined,
    onReconnect: () => console.warn("Try to reconnect..."),
    onStop: undefined,
    onBan: (client, reason, endTime) => {
        let message: string
        if (endTime === -1) {
            message =
                "You have been permanently banned because:\n" +
                reason
        } else {
            const endDate = new Date(endTime)
            const endTimeString = endDate.getHours() + ":" + endDate.getMinutes() + " " + endDate.getSeconds() + "s"
            message =
                "You have been temporarily banned for " +
                endTimeString + " because:\n" +
                reason
        }
        console.error(message)
        alert(message)
    },
    onKick: (client, reason) => {
        console.error("You were kicked from the server!")
        alert("You were kicked from the server!")
    },
    onDebug: undefined,

    determineApiTimes: 8,
    determineApi: undefined,
    determineApiRequestTimeoutMillis: 1000 * 8,

    nodeConnectTimes: 8,
    nodeConnectTimeoutMillis: 100,

    initWsTimeoutMillis: 1000 * 16
}

export class StatefullClient {
    readonly settings: StatefullClientSettings
    sourceApiUrl: string
    apiUrl: string
    sfSettings: StatefullExportSettings
    nodeUrl: string
    sfws: StatefullWebSocket
    socketPromise: Promise<void>

    loopId: number
    started: boolean = false
    ready: boolean = false

    constructor(
        options?: StatefullClientOptions
    ) {
        this.settings = {
            ...defaultStatefullClientSettings,
            ...options
        }

        const banned = this.isBannedBan()
        if (typeof banned === "number") {
            (
                async () => this.settings.onBan && await this.settings.onBan(
                    this,
                    this.getBanReason(),
                    banned
                )
            )()
                .finally(
                    () => process.exit(1)
                )
            throw new Error("Client is banned!")
        }
    }

    isPermaBan(): boolean {
        return
    }

    isBannedBan(): number | undefined {
        const banEndTime = this.getBanTime()
        if (banEndTime === -1) {
            return -1
        }
        if (banEndTime > Date.now()) {
            return banEndTime
        }
        localStorage.removeItem(
            btoa("STATEFULL_BAN_TIME")
        )
        return undefined
    }

    getBanReason(): string {
        return atob(
            localStorage.getItem(
                btoa("STATEFULL_BAN_REASON")
            ) ?? ""
        )
    }

    getBanTime(): number {
        let banEndTime = Number(
            atob(
                localStorage.getItem(
                    btoa("STATEFULL_BAN_TIME")
                )
            )
        )
        if (
            isNaN(banEndTime) ||
            banEndTime < -1
        ) {
            banEndTime === -1
        }
        return banEndTime
    }

    async allocate(
        reason: string
    ): Promise<void> {
        this.settings.onAllocate && await this.settings.onAllocate(
            this,
            reason,
        )
        const staticApiUrl: boolean = typeof this.settings.determineApi === "string"
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "info",
            "Api url determine strategy: " +
            (staticApiUrl ? "STATIC" : "AUTO")
        )
        this.sourceApiUrl = this.apiUrl = staticApiUrl ?
            this.settings.determineApi as string :
            determineStatfullApi(
                this.settings.determineApi as any
            )
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "info",
            "Fetch api settings from: " +
            this.apiUrl + " ..."
        )
        this.sfSettings = await fetchApiSettings(this.apiUrl)

        let determineApiTries: number = 0
        while (this.apiUrl !== this.sfSettings.externalUrl) {
            this.settings.onDebug && await this.settings.onDebug(
                this,
                "StatefullClient",
                "info",
                "Fetch api settings again from new external url: " +
                this.sfSettings.externalUrl + " ..."
            )
            this.apiUrl = this.sfSettings.externalUrl
            this.sfSettings = await fetchApiSettings(this.apiUrl)
            if (determineApiTries > this.settings.determineApiTimes) {
                const errMessage =
                    "Tried to determine api url from api settings but get always different values!\n" +
                    "Api url: " + this.apiUrl + "\n" +
                    "Settings external url: " + this.sfSettings.externalUrl + " ..."
                this.settings.onDebug && await this.settings.onDebug(
                    this,
                    "StatefullClient",
                    "error",
                    errMessage
                )
                throw new Error(errMessage)
            }
            await new Promise(
                (res) => setTimeout(
                    res,
                    this.settings.determineApiRequestTimeoutMillis
                )
            )
            determineApiTries++
        }

        this.nodeUrl = await allocateNode(this.sfSettings)
    }

    async connect(): Promise<WebSocketCloseInfo> {
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "location",
            "> connect()"
        )
        return new Promise<WebSocketCloseInfo>(async (res, rej) => {
            this.sfws = new StatefullWebSocket(this)
            const initData = await this.sfws.initPromise
            this.ready = true
            this.settings.onInit && await this.settings.onInit(
                this,
                initData,
            )
            this.sfws.originWs.onmessage = async (event) => {
                const data = JSON.parse(event.data)
                if (typeof data !== "object") {
                    rej(new Error("Received json value is not an object"))
                    return
                }
                await this.settings.onData(
                    this,
                    data,
                )
            }
            this.sfws.originWs.onclose = async (event) => {
                this.ready = false
                const closeInfo = getCloseInfo(event.code, event.reason)
                this.settings.onDisconnect && await this.settings.onDisconnect(
                    this,
                    closeInfo,
                )
                this.settings.onDebug && await this.settings.onDebug(
                    this,
                    "StatefullClient",
                    "location",
                    "< connect()"
                )
                res(closeInfo)
            }
            this.sfws.originWs.onerror = async (err: Error | any) => {
                this.ready = false
                rej(err)
            }
        })
    }

    async disconnect(): Promise<void> {
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "location",
            "> disconnect()"
        )
        if (this.sfws === undefined) {
            this.settings.onDebug && await this.settings.onDebug(
                this,
                "StatefullClient",
                "info",
                "Dont close websocket because its not defined..."
            )
            return
        }
        if (this.sfws.isConnected()) {
            this.settings.onDebug && await this.settings.onDebug(
                this,
                "StatefullClient",
                "info",
                "Close websocket connection..."
            )
            this.sfws.normalClose()
        } else {
            this.settings.onDebug && await this.settings.onDebug(
                this,
                "StatefullClient",
                "info",
                "Dont close websocket because its already closed..."
            )
        }
        this.sfws = undefined
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "location",
            "< disconnect()"
        )
    }

    async start(): Promise<void> {
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "location",
            "> start()"
        )
        this.started = true
        const loopId = this.loopId = Date.now()
        this.settings.onStart && await this.settings.onStart(
            this,
        )
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "location",
            "> while()"
        )
        let timeoutMillis: number = this.settings.nodeConnectTimeoutMillis
        let connectTries: number = 0
        let closeInfo: WebSocketCloseInfo
        while (
            this.started &&
            loopId === this.loopId
        ) {
            try {
                this.settings.onDebug && await this.settings.onDebug(
                    this,
                    "StatefullClient",
                    "info",
                    "Connecting..."
                )
                await this.disconnect()
                if (
                    typeof this.nodeUrl !== "string" ||
                    this.nodeUrl.length === 0
                ) {
                    this.settings.onDebug && await this.settings.onDebug(
                        this,
                        "StatefullClient",
                        "info",
                        "Allocate node target before can connect..."
                    )
                    await this.allocate("Init")
                }
                closeInfo = await this.connect()
                this.settings.onDebug && await this.settings.onDebug(
                    this,
                    "StatefullClient",
                    "info",
                    "Connection closed: ",
                    closeInfo
                )
                if (closeInfo.code === StatefullWebSocket.STATEFULL_BAN) {
                    const splitted = closeInfo.reason.split(":")
                    let rawBanTime = splitted[0]
                    const reason = splitted.slice(1).join(":")
                    while (
                        rawBanTime.startsWith(" ") ||
                        rawBanTime.startsWith(":") ||
                        rawBanTime.startsWith("/")
                    ) {
                        rawBanTime = rawBanTime.substring(1)
                    }
                    while (
                        rawBanTime.endsWith(" ") ||
                        rawBanTime.endsWith(":") ||
                        rawBanTime.endsWith("/")
                    ) {
                        rawBanTime = rawBanTime.slice(0, -1)
                    }
                    const banTime = Number(rawBanTime)
                    const endBanTime = banTime + Date.now()
                    if (
                        !isNaN(banTime) &&
                        banTime >= -1
                    ) {
                        localStorage.setItem(
                            btoa("STATEFULL_BAN_TIME"),
                            "" + endBanTime
                        )
                        localStorage.setItem(
                            btoa("STATEFULL_BAN_REASON"),
                            "" + reason
                        )
                    }
                    this.started = false
                    this.loopId = -1
                    setTimeout(() => process.exit(1), 1000 * 5)
                    this.settings.onBan && await this.settings.onBan(
                        this,
                        reason,
                        endBanTime,
                    )
                    process.exit(1)
                    break
                } else if (closeInfo.code === StatefullWebSocket.STATEFULL_KICK) {
                    this.started = false
                    this.loopId = -1
                    setTimeout(() => process.exit(1), 1000 * 5)
                    this.settings.onKick && await this.settings.onKick(
                        this,
                        closeInfo.reason,
                    )
                    process.exit(1)
                    break
                } else if (closeInfo.code === StatefullWebSocket.STATEFULL_ALLOCATE_NODE) {
                    await this.allocate(closeInfo.reason)
                } else if (closeInfo.code === StatefullWebSocket.STATEFULL_NORMAL_CLOSE) {
                    break
                } else if (![1006].includes(closeInfo.code)) {
                    //TODO check for connection dropped status code
                    throw new Error(
                        "Unknown websocket close code: " + closeInfo.code
                    )
                }
                timeoutMillis = this.settings.nodeConnectTimeoutMillis
                connectTries = 0
            } catch (err: Error | any) {
                if (
                    connectTries > this.settings.nodeConnectTimes ||
                    (
                        typeof err === "object" &&
                        typeof err.message === "string" &&
                        err.message.length > 0 &&
                        err.message.startsWith("Unknown websocket close code: ")
                    )
                ) {
                    this.settings.onError && this.settings.onError(
                        this,
                        err,
                    )
                    break
                }
            }
            await new Promise<void>((res) => setTimeout(res, timeoutMillis))
            timeoutMillis += timeoutMillis * 3
            connectTries++

            this.settings.onReconnect && await this.settings.onReconnect(
                this,
            )
        }
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "location",
            "< while()"
        )
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "location",
            "< start()"
        )
    }

    async stop(): Promise<void> {
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "location",
            "> stop()"
        )
        this.settings.onStop && await this.settings.onStop(this)
        this.started = false
        this.loopId = -1
        await this.disconnect()
        this.settings.onDebug && await this.settings.onDebug(
            this,
            "StatefullClient",
            "location",
            "< stop()"
        )
    }
}

export default StatefullClient
