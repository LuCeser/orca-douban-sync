import { setupL10N, t } from "./libs/l10n"
import type { DbId } from "./orca.d.ts"
import zhCN from "./translations/zhCN"

const { subscribe } = window.Valtio

let pluginName: string
let unsubscribe: () => void
let prevMagicTagName: string

export async function load(_name: string) {
  pluginName = _name

  setupL10N(orca.state.locale, { "zh-CN": zhCN })

  // 设置插件配置
  await orca.plugins.setSettingsSchema(pluginName, {
    provider: {
      label: t("AI Provider"),
      description: t("Select AI service provider"),
      type: "singleChoice",
      defaultValue: "openai",
      choices: [
        { label: "OpenAI", value: "openai" },
        { label: "Ollama", value: "ollama" }
      ]
    },
    endpoint: {
      label: t("API Endpoint"),
      description: t("API endpoint URL"),
      type: "string",
      defaultValue: "https://api.openai.com/v1"
    },
    apiKey: {
      label: t("API Key"),
      description: t("Your API key"),
      type: "string",
      defaultValue: ""
    },
    model: {
      label: t("Model"),
      description: t("AI model name"),
      type: "string",
      defaultValue: "gpt-3.5-turbo"
    },
    temperature: {
      label: t("Temperature"),
      description: t("Response randomness (0-1)"),
      type: "number",
      defaultValue: 0.7
    },
    maxTokens: {
      label: t("Max Tokens"),
      description: t("Maximum response length"),
      type: "number",
      defaultValue: 2000
    }
  })

  prevMagicTagName = "Magic"
  await readyMagicTag()

  // 注册斜杠命令
  orca.slashCommands.registerSlashCommand(`${pluginName}.magic`, {
    icon: "✨",
    group: "AI",
    title: t("Magic AI"),
    command: `${pluginName}.executeAI`
  })

  orca.commands.registerCommand(
  'myPlugin.sayHello',
  async () => {
    console.log('Hello!');
  },
  '打招呼'
);

  // 注册命令
  orca.commands.registerCommand(
    `${pluginName}.executeAI`,
    async (blockId: DbId) => {
      try {
        const block = orca.state.blocks[blockId]
        
        if (!block) {
          throw new Error('Block not found')
        }

        const settings = orca.state.plugins[pluginName]!.settings!
        // 检查是否有 Magic 标签或引用 Magic 标签的 block
        const hasMagicTag = block?.refs?.some(ref => ref.type === 2 && ref.alias === 'Magic');
        const magicRef = block?.refs?.find(ref => 
          ref.type === 2 && 
          orca.state.blocks[ref.id]?.refs?.some(r => r.type === 2 && r.alias === 'Magic')
        );

      // 如果既没有Magic标签也没有Magic引用，则返回
        if (!hasMagicTag && !magicRef) {
          throw new Error('No AI template found')
        }
        
        // 获取提示词
        let prompt = ""
        if (magicRef) {
          const templateBlock = orca.state.blocks[magicRef.id]
          prompt = templateBlock.text ?? ""
        }
        
        // 生成响应
        orca.notify('info', 'Generating AI response...')
        const response = await generateAIResponse(prompt, settings)
        
        // 更新块内容
        await orca.commands.invokeEditorCommand(
          "core.editor.updateBlock",
          null,
          blockId,
          [{ t: "p", v: response }]
        )
        
        orca.notify('success', 'AI response generated')
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
        orca.notify('error', message)
      }
    }
  )

  // 监听设置变化
  unsubscribe = subscribe(orca.state.plugins[pluginName]!, async () => {
    if (orca.state.plugins[pluginName]!.settings) {
      await readyMagicTag(true)
    }
  })
}

export async function unload() {
  unsubscribe?.()
  orca.slashCommands.unregisterSlashCommand(`${pluginName}.magic`)
  orca.commands.unregisterCommand(`${pluginName}.executeAI`)
}

// 准备 Magic 标签
async function readyMagicTag(isUpdate = false) {

  let { id: magicBlockId } = 
    (await orca.invokeBackend("get-blockid-by-alias", "Magic")) ?? {}
  const nonExistent = magicBlockId == null

  if (nonExistent) {
    await orca.commands.invokeGroup(async () => {
      magicBlockId = await orca.commands.invokeEditorCommand(
        "core.editor.insertBlock",
        null,
        null,
        null,
        [{ t: "t", v: "Magic" }]
      )

      await orca.commands.invokeEditorCommand(
        "core.editor.createAlias",
        null,
        "Magic",
        magicBlockId
      )
    })
  }

  if (isUpdate || nonExistent) {
    // 设置 Magic 标签属性
    await orca.commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [magicBlockId],
      [
        {
          name: "ai",
          type: 6,
          typeArgs: {
            subType: "single",
            choices: ["template", "reference"]
          }
        }
      ]
    )
  }
}

// AI 响应生成
async function generateAIResponse(prompt: string, settings: any): Promise<string> {
  const { provider, endpoint, apiKey, model, temperature, maxTokens } = settings

  try {
    if (provider === 'openai') {
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens
        })
      })

      const data = await response.json()
      return data.choices[0].message.content
    } else {
      const response = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          prompt,
          temperature,
          max_tokens: maxTokens
        })
      })

      const data = await response.json()
      return data.response
    }
  } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`AI generation failed: ${message}`)
  }
}