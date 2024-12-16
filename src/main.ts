import { setupL10N, t } from "./libs/l10n"
import { getMirrorId } from "./libs/utils.ts"
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
    group: "Magic Note",
    title: t("Magic"),
    command: `${pluginName}.executeAI`
  })

  // 注册命令
  orca.commands.registerEditorCommand(
    `${pluginName}.executeAI`,
    async ([, , cursor], blockId?: DbId) => {

      try {
        // 如果没有传入 blockId，使用光标所在的块
        const targetBlockId = blockId ?? cursor.anchor.blockId;
        const block = orca.state.blocks[targetBlockId];

        if (!block) {
          throw new Error('Block not found')
        }

        console.log(blockId + ' ' + targetBlockId + ' block: ' + JSON.stringify(block))

        const settings = orca.state.plugins[pluginName]!.settings!

        // 检查是否有 Magic 标签或引用 Magic 标签的 block
        const magicRef = block?.refs?.find(ref => 
          ref.type === 2 && 
          ref.data?.some(data => data.name === 'magic' && data.type === 2));

        console.log('magicRef: ' + JSON.stringify(magicRef) )

      // 如果没有引用模板，则返回
        if (!magicRef) {
          throw new Error('No AI template found')
        }

        // 获取模板
        const magicRefProp = magicRef.data?.find(data => data.name === 'magic' && data.type === 2)
        console.log('magicProp: ' + JSON.stringify(magicRefProp))
        if (!Array.isArray(magicRefProp?.value) || magicRefProp?.value.length !== 1) {
          throw new Error('Too many AI template found')
        }         
        const magicRefId = magicRefProp?.value[0]
        console.log('magicRefId: ' + magicRefId)

        const magic = block?.refs?.find(ref => 
          ref.id === magicRefId
        );

        if (!magic) {
          throw new Error('Magic block not found')
        }

        const magicId = getMirrorId(magic.to ?? 0) // 添加默认值 0 避免 undefined

        let magicBlock = orca.state.blocks[magic.to];
        if (!magicBlock) {
          console.log('magicId: ' + magicId + 'cannot find magicBlock, try to get it from backend')
          magicBlock = await orca.invokeBackend("get-block", magicId);
        }

        console.log('magicBlock: ' + JSON.stringify(magicBlock))

        // 获取提示词
        let systemPrompt = ""
        if (magicBlock) {
          if(Array.isArray(magicBlock.children) && magicBlock.children.length > 0) {
            for (const child of magicBlock.children) {
              let childBlock = orca.state.blocks[child]
              if (!childBlock) {
                childBlock = await orca.invokeBackend("get-block", child);
              }
              systemPrompt += childBlock.text ?? ""
            }
          } else {
            console.log('magicBlock has no children')
          }
        }

        let userPrompt = ""
        for (const child of block.children) {
          let childBlock = orca.state.blocks[child]
          if (!childBlock) {
            childBlock = await orca.invokeBackend("get-block", child);
          }
          userPrompt += childBlock.text ?? ""
          userPrompt += "\n"
        }
        
        // 生成响应
        orca.notify('success', 'Generating AI response...')
        const response = await generateAIResponse(systemPrompt, userPrompt, settings)
        console.log(response)
        // 修改单个块的内容
        await orca.commands.invokeEditorCommand(
          "core.editor.insertBlock",
          null,
          block, // 块ID数组
          "lastChild", 
          [{ t: "t", v: response }] // ContentFragment数组
        );
        return null
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          orca.notify('error', message)
          return null
      }
    },
    () => {},
    {label: t("Generate AI Response")},
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
        }
      ]
    )
  }
}

// AI 响应生成
async function generateAIResponse(system: string, prompt: string, settings: any): Promise<string> {
  const { endpoint, apiKey, model, temperature, maxTokens } = settings

  try {
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens,
          stream: false
        })
      })
      const data = await response.json()
      return data.choices[0].message.content
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`AI generation failed: ${message}`)
  }
}