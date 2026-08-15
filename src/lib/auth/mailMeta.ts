/**
 * 开发邮件模式元信息（零依赖，客户端页面与 API 路由都可安全引用）。
 * 开发模式下验证/重置邮件不真实发送，链接经 API 响应头返回给前端展示；
 * 正式环境（生产 + SMTP）绝不下发该响应头。
 */
export const DEV_MAIL_LINK_HEADER = 'x-dev-mail-link';
