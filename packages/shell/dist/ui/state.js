export function createState(history) {
    return {
        loggedIn: false,
        commands: [],
        topics: [],
        subscriptions: new Map(),
        minLevel: "all",
        paused: false,
        pausedDropped: 0,
        pendingUser: null,
        history,
        cursor: history.length,
    };
}
/** 订阅规格串：`top`，或 `top:2000`（带间隔）。 */
export function topicSpec(subscriptions) {
    return [...subscriptions.entries()]
        .map(([name, interval]) => (interval === undefined ? name : `${name}:${interval}`))
        .join(",");
}
