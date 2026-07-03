/**
 * 慕课网手记适配器
 * https://www.imooc.com
 */
import { CodeAdapter, ImageUploadResult } from "../code-adapter";
import type {
  Article,
  AuthResult,
  SyncResult,
  PlatformMeta,
} from "../../types";
import { ArticleProcessor } from "../article-processor";
export class ImoocAdapter extends CodeAdapter {
  meta: PlatformMeta = {
    id: "imooc",
    name: "慕课手记",
    icon: "https://www.imooc.com/favicon.ico",
    homepage: "https://www.imooc.com/article",
    capabilities: ["article", "draft", "image_upload"],
  };

  /** 预处理配置: 慕课网使用 Markdown 格式 */
  readonly preprocessConfig = {
    outputFormat: "markdown" as const,
  };

  /** 慕课网 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: "*://www.imooc.com/article/*",
      headers: {
        Origin: "https://www.imooc.com",
        Referer: "https://www.imooc.com/",
      },
      resourceTypes: ["xmlhttprequest"],
    },
  ];

  /**
   * 检查登录状态
   */
  async checkAuth(): Promise<AuthResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      const response = await this.runtime.fetch(
        "https://www.imooc.com/u/card",
        {
          credentials: "include",
        },
      );
      let text = await response.text();

      // 解析 JSONP 响应
      text = text.replace("jsonpcallback(", "").replace("})", "}");
      const result = JSON.parse(text);

      if (result.result !== 0) {
        return { isAuthenticated: false, error: result.msg || "未登录" };
      }

      return {
        isAuthenticated: true,
        userId: result.data.uid,
        username: result.data.nickname,
        avatar: result.data.img,
      };
    }).catch((error) => ({
      isAuthenticated: false,
      error: (error as Error).message,
    }));
  }

  /**
   * 上传图片
   */
  async uploadImageByUrl(url: string): Promise<ImageUploadResult> {
    // 下载图片
    const imageResponse = await this.runtime.fetch(url);
    const blob = await imageResponse.blob();

    // 构建 FormData
    const formData = new FormData();
    const filename = `${Date.now()}.jpg`;
    const file = new File([blob], filename, {
      type: blob.type || "image/jpeg",
    });

    formData.append("photo", file, filename);
    formData.append("type", file.type);
    formData.append("id", "WU_FILE_0");
    formData.append("name", filename);
    formData.append("lastModifiedDate", new Date().toString());
    formData.append("size", String(file.size));

    const response = await this.runtime.fetch(
      "https://www.imooc.com/article/ajaxuploadimg",
      {
        method: "POST",
        credentials: "include",
        body: formData,
      },
    );

    const res = await response.json();

    if (res.result !== 0) {
      throw new Error(res.msg || "图片上传失败");
    }

    // 处理协议相对 URL
    let imgUrl = res.data.imgpath;
    if (imgUrl.startsWith("//")) {
      imgUrl = "https:" + imgUrl;
    }

    return { url: imgUrl };
  }

  /**
   * 发布文章
   */
  async publish(article: Article, options?: any): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      // 根据 preprocessConfig.outputFormat 选择使用哪种格式
      let processed;
      if (this.preprocessConfig?.outputFormat === "markdown") {
        // 使用 markdown 格式
        processed = ArticleProcessor.processContent(
          { ...article, content: article.markdown },
          {
            supportsTags: true,
            supportsSummary: true,
            supportsCategory: true,
            supportsCover: true,
            supportsAuthor: true,
          },
        );
      } else {
        // 使用 html 格式
        processed = ArticleProcessor.processHtmlContent(article, {
          supportsTags: true,
          supportsSummary: true,
          supportsCategory: true,
          supportsCover: true,
          supportsAuthor: true,
        });
      }

      // 封面图处理
      let coverUrl: string | null = null;
      if (processed.cover) {
        try {
          const coverResult = await this.uploadImageByUrl(processed.cover);
          coverUrl = coverResult.url;
        } catch (error) {
          console.error("封面上传失败:", error);
        }
      }

      // 处理文章内容中的图片
      let content = await this.processImages(
        processed.content,
        (src) => this.uploadImageByUrl(src),
        {
          onProgress: options?.onImageProgress,
        },
      );

      // 构建请求数据
      const postData: Record<string, string> = {
        editor: "0",
        draft_id: "0",
        title: processed.title,
        content: content,
      };

      // 如果有封面图，添加封面字段
      if (coverUrl) {
        postData["cover"] = coverUrl;
      }

      // 如果有标签，添加标签字段
      if (processed.tags.length > 0) {
        postData["tags"] = processed.tags.join(",");
      }

      // 如果有摘要，添加摘要字段
      if (processed.summary) {
        postData["summary"] = processed.summary;
      }

      // 如果有分类，添加分类字段
      if (processed.category) {
        postData["category"] = processed.category;
      }

      // 如果有文章类型，添加文章类型字段
      if (processed.articleType === "original") {
        postData["is_original"] = "1";
      }

      const response = await this.runtime.fetch(
        "https://www.imooc.com/article/savedraft",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(postData),
        },
      );

      const res = await response.json();

      if (!res.data) {
        throw new Error("发布失败");
      }

      return this.createResult(true, {
        postId: res.data,
        postUrl: `https://www.imooc.com/article/draft/id/${res.data}`,
        draftOnly: true,
      });
    }).catch((error) =>
      this.createResult(false, {
        error: (error as Error).message,
      }),
    );
  }
}
