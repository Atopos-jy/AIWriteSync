import type {
  PlatformAdapter,
  AdapterRegistryEntry,
  PreprocessConfig,
} from "./types";
import { DEFAULT_PREPROCESS_CONFIG } from "./types";
import type { RuntimeInterface } from "../runtime/interface";
import type { PlatformMeta } from "../types";

/**
 * 平台匹配规则
 */
interface PlatformMatchRule {
  id: string;
  hostname?: string[];
  pathnameRegex?: RegExp[];
}

/**
 * 适配器注册中心
 * 管理所有平台适配器的注册和获取
 */
class AdapterRegistry {
  private adapters: Map<string, AdapterRegistryEntry> = new Map();
  private instances: Map<string, PlatformAdapter> = new Map();
  private runtime?: RuntimeInterface;

  /**
   * 平台匹配规则配置
   */
  private platformMatchRules: PlatformMatchRule[] = [
    { id: "weixin", hostname: ["mp.weixin.qq.com"] },
    {
      id: "toutiao-extract",
      hostname: [
        "www.toutiao.com",
        "www.toutiaocdn.com",
        "p3.pstatp.com",
        "www.toutiao.io",
      ],
      pathnameRegex: [/\/item\//, /\/group\//, /\/article\//, /\/p\//],
    },
    {
      id: "toutiao",
      hostname: ["www.toutiao.com", "www.toutiaocdn.com", "mp.toutiao.com"],
    },
    { id: "zhihu", hostname: ["www.zhihu.com"] },
    {
      id: "csdn",
      hostname: ["blog.csdn.net", "www.csdn.net", "editor.csdn.net"],
    },
    { id: "oschina", hostname: ["my.oschina.net", "www.oschina.net"] },
    { id: "juejin", hostname: ["juejin.cn"] },
    { id: "github", hostname: ["github.com"] },
    { id: "segmentfault", hostname: ["segmentfault.com"] },
    { id: "yuque", hostname: ["www.yuque.com"] },
    { id: "yidian", hostname: ["mp.yidianzixun.com"] },
    { id: "woshipm", hostname: ["www.woshipm.com"] },
    { id: "weibo", hostname: ["card.weibo.com", "weibo.com"] },
    { id: "sohu", hostname: ["mp.sohu.com"] },
    { id: "jianshu", hostname: ["www.jianshu.com"] },
    { id: "imooc", hostname: ["www.imooc.com"] },
    { id: "douban", hostname: ["www.douban.com"] },
    { id: "dayu", hostname: ["mp.dayu.com"] },
    { id: "51cto", hostname: ["blog.51cto.com"] },
    { id: "bilibili", hostname: ["member.bilibili.com"] },
    {
      id: "baijiahao-extract",
      hostname: ["baijiahao.baidu.com"],
      pathnameRegex: [/\/s\//],
    },
    {
      id: "bilibili-extract",
      hostname: ["bilibili.com"],
      pathnameRegex: [/\/read\/cv|\/article\//],
    },
    { id: "baijiahao", hostname: ["baijiahao.baidu.com"] },
    { id: "cnblogs", hostname: ["www.cnblogs.com"] },
  ];

  /**
   * 设置运行时
   */
  setRuntime(runtime: RuntimeInterface): void {
    this.runtime = runtime;
    // 清空已有实例，等待重新初始化
    this.instances.clear();
  }

  /**
   * 注册适配器
   */
  register(entry: AdapterRegistryEntry): void {
    this.adapters.set(entry.meta.id, entry);
  }

  /**
   * 批量注册
   */
  registerAll(entries: AdapterRegistryEntry[]): void {
    entries.forEach((entry) => this.register(entry));
  }

  /**
   * 获取适配器实例
   */
  async get(platformId: string): Promise<PlatformAdapter | null> {
    // 检查缓存
    if (this.instances.has(platformId)) {
      return this.instances.get(platformId)!;
    }

    // 查找注册项
    const entry = this.adapters.get(platformId);
    if (!entry) {
      return null;
    }

    if (!this.runtime) {
      throw new Error("Runtime not set. Call setRuntime() first.");
    }

    // 创建并初始化实例
    const adapter = entry.factory(this.runtime);
    await adapter.init(this.runtime);
    this.instances.set(platformId, adapter);

    return adapter;
  }

  /**
   * 根据当前 URL 获取对应的平台适配器
   */
  async getCurrentPlatform(url: string): Promise<PlatformAdapter | null> {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;

      // 根据主机名和路径匹配平台
      for (const rule of this.platformMatchRules) {
        const entry = this.adapters.get(rule.id);
        if (!entry) continue;

        // 匹配主机名
        if (rule.hostname && !rule.hostname.some((h) => hostname.includes(h))) {
          continue;
        }

        // 匹配路径
        if (
          rule.pathnameRegex &&
          !rule.pathnameRegex.some((regex) => regex.test(pathname))
        ) {
          continue;
        }

        // 找到匹配的平台，返回适配器实例
        return this.get(rule.id);
      }
    } catch (error) {
      console.error("Error matching platform:", error);
    }

    return null;
  }

  /**
   * 获取所有平台元信息
   */
  getAllMeta(): PlatformMeta[] {
    return Array.from(this.adapters.values()).map((entry) => entry.meta);
  }

  /**
   * 检查平台是否已注册
   */
  has(platformId: string): boolean {
    return this.adapters.has(platformId);
  }

  /**
   * 获取已注册的平台 ID 列表
   */
  getRegisteredIds(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * 清空注册
   */
  clear(): void {
    this.adapters.clear();
    this.instances.clear();
  }

  /**
   * 获取平台的预处理配置
   */
  getPreprocessConfig(platformId: string): PreprocessConfig {
    const entry = this.adapters.get(platformId);
    return {
      ...DEFAULT_PREPROCESS_CONFIG,
      ...(entry?.preprocessConfig || {}),
    };
  }

  /**
   * 获取多个平台的预处理配置
   */
  getPreprocessConfigs(
    platformIds: string[],
  ): Record<string, PreprocessConfig> {
    const configs: Record<string, PreprocessConfig> = {};
    for (const id of platformIds) {
      configs[id] = this.getPreprocessConfig(id);
    }
    return configs;
  }

  /**
   * 自动匹配当前页面所属平台
   */
  async matchCurrentPlatform(): Promise<PlatformAdapter | null> {
    try {
      console.log(
        "[AdapterRegistry] 开始匹配平台，已注册适配器:",
        Array.from(this.adapters.keys()),
      );

      // 遍历所有已注册的平台适配器
      for (const platformId of this.adapters.keys()) {
        console.log("[AdapterRegistry] 检查适配器:", platformId);

        // 获取适配器实例（确保已初始化）
        const adapter = await this.get(platformId);
        if (!adapter) {
          console.log("[AdapterRegistry] 适配器实例获取失败:", platformId);
          continue;
        }

        // 检查适配器是否有 match 方法
        if (typeof adapter.match === "function") {
          console.log("[AdapterRegistry] 调用适配器 match 方法:", platformId);
          // 调用适配器的 match 方法
          const matched = await adapter.match();
          console.log("[AdapterRegistry] 适配器匹配结果:", platformId, matched);
          if (matched) {
            console.log("[AdapterRegistry] 找到匹配的平台:", platformId);
            return adapter;
          }
        } else {
          console.log("[AdapterRegistry] 适配器没有 match 方法:", platformId);
        }
      }

      console.log("[AdapterRegistry] 没有找到匹配的平台");
    } catch (error) {
      console.error("Error matching current platform:", error);
    }

    return null;
  }
}

/**
 * 全局适配器注册中心实例
 */
export const adapterRegistry = new AdapterRegistry();

/**
 * 注册适配器的便捷函数
 */
export function registerAdapter(entry: AdapterRegistryEntry): void {
  adapterRegistry.register(entry);
}

/**
 * 获取适配器的便捷函数
 */
export async function getAdapter(
  platformId: string,
): Promise<PlatformAdapter | null> {
  return adapterRegistry.get(platformId);
}

/**
 * 获取平台的预处理配置
 */
export function getPreprocessConfig(platformId: string): PreprocessConfig {
  return adapterRegistry.getPreprocessConfig(platformId);
}

/**
 * 获取多个平台的预处理配置
 */
export function getPreprocessConfigs(
  platformIds: string[],
): Record<string, PreprocessConfig> {
  return adapterRegistry.getPreprocessConfigs(platformIds);
}

/**
 * 自动匹配当前页面所属平台的便捷函数
 */
export async function matchCurrentPlatform(): Promise<PlatformAdapter | null> {
  return adapterRegistry.matchCurrentPlatform();
}

/**
 * 根据 URL 获取对应的平台适配器的便捷函数
 */
export async function getCurrentPlatform(
  url: string,
): Promise<PlatformAdapter | null> {
  return adapterRegistry.getCurrentPlatform(url);
}
