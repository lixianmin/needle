export declare const ResponseX: {
    /** 400：请求本身不合法（body 不是 JSON、字段类型不对、空命令、命令不存在）。 */
    badRequest: (message: string) => Response;
    /** 401：没带 token 或 token 无效。 */
    unauthorized: (message: string) => Response;
    /** 401：口令错。与 unauthorized 分开，因为客户端该做的事不一样（重新登录 ≠ 改密码）。 */
    badCredentials: (message: string) => Response;
    /** 404：路径或方法没命中、日志文件不存在。 */
    notFound: (message: string) => Response;
    /** 413：请求体超过上限。 */
    payloadTooLarge: (message: string) => Response;
    /** 500：命令抛错或服务内部出错。 */
    internalError: (message: string) => Response;
    /** 503：`dispose()` 之后，服务不再可用。 */
    unavailable: (message: string) => Response;
    /** 504：命令超时。 */
    gatewayTimeout: (message: string) => Response;
};
