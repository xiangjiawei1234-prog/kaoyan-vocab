// 考研长难句拆解练习 · 语料数据（手写标注）
// 结构：segments 拼接后必须等于 text；r: sk=主干, cl=从句, mod=修饰/插入
window.LONG_SENTENCE_DATA = [
 {
  "id": "en1-2010-circuit",
  "source": "英语一 · 2010 · Text 2",
  "text": "The Federal Circuit issued an unusual order stating that the case would be heard by all 12 of the court's judges, rather than a typical panel of three, and that one issue it wants to evaluate is whether it should \"reconsider\" its State Street Bank ruling.",
  "segments": [
   {
    "r": "sk",
    "t": "The Federal Circuit issued an unusual order"
   },
   {
    "r": "mod",
    "t": " stating "
   },
   {
    "r": "cl",
    "t": "that the case would be heard by all 12 of the court's judges"
   },
   {
    "r": "mod",
    "t": ", rather than a typical panel of three, "
   },
   {
    "r": "cl",
    "t": "and that one issue it wants to evaluate is whether it should \"reconsider\" its State Street Bank ruling."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "The Federal Circuit issued an unusual order"
   },
   {
    "k": "非谓语后置定语",
    "t": "stating …（= which stated …）"
   },
   {
    "k": "宾语从句①",
    "t": "that the case would be heard by all 12 of the court's judges"
   },
   {
    "k": "介词对比",
    "t": "rather than a typical panel of three"
   },
   {
    "k": "宾语从句②（与①并列）",
    "t": "and that one issue … is whether …"
   },
   {
    "k": "定语从句（省略 that）",
    "t": "(that) it wants to evaluate 修饰 one issue"
   },
   {
    "k": "表语从句",
    "t": "whether it should \"reconsider\" its State Street Bank ruling"
   }
  ],
  "translation": "联邦巡回上诉法院发布了一项不同寻常的命令，声明本案将由该院全部 12 名法官共同审理，而不是通常的三人合议庭；并声明该院希望评估的一个问题是：是否应当“重新审议”其关于道富银行案的裁决。",
  "tips": [
   "stating 为现在分词作后置定语，修饰 order；可还原为 which stated …。",
   "and 连接两个并列 that 从句，同作 stating 的宾语；rather than … 插在两者之间，容易把后半句主干看丢。",
   "one issue it wants to evaluate 中省略了关系代词 that，定语从句修饰 issue。",
   "whether … 作表语从句，回应 one issue 的内容。"
  ]
 },
 {
  "id": "en1-2012-billboard",
  "source": "英语一 · 2012 · Text 1",
  "text": "\"Dare to be different, please don't smoke!\" pleads one billboard campaign aimed at reducing smoking among teenagers—teenagers, who desire nothing more than fitting in.",
  "segments": [
   {
    "r": "mod",
    "t": "\"Dare to be different, please don't smoke!\" "
   },
   {
    "r": "sk",
    "t": "pleads one billboard campaign"
   },
   {
    "r": "mod",
    "t": " aimed at reducing smoking among teenagers"
   },
   {
    "r": "mod",
    "t": "—teenagers"
   },
   {
    "r": "cl",
    "t": ", who desire nothing more than fitting in."
   }
  ],
  "structure": [
   {
    "k": "主干（倒装）",
    "t": "one billboard campaign pleads \"…\""
   },
   {
    "k": "过去分词后置定语",
    "t": "aimed at reducing smoking among teenagers"
   },
   {
    "k": "同位语",
    "t": "teenagers（对 among teenagers 的复指强调）"
   },
   {
    "k": "非限制性定语从句",
    "t": "who desire nothing more than fitting in"
   }
  ],
  "translation": "“敢于与众不同，请不要吸烟！”一块旨在减少青少年吸烟的广告牌这样呼吁——而这些青少年，最想要的不过是融入群体。",
  "tips": [
   "引语前置导致主谓倒装：正常语序是 one billboard campaign pleads \"…\"。",
   "aimed at … 为过去分词短语作后置定语，修饰 campaign。",
   "破折号后的 teenagers 是同位语复指，紧跟 who 非限制性定语从句，解释为何广告难打动人。",
   "nothing more than = 只不过；fitting in 为动名词，作 desire 的宾语。"
  ]
 },
 {
  "id": "en1-2013-overdressed",
  "source": "英语一 · 2013 · Text 1",
  "text": "Towards the end of Overdressed, Cline introduced her ideal, a Brooklyn woman named Sarah Kate Beaumont, who since 2008 has made all of her own clothes – and beautifully.",
  "segments": [
   {
    "r": "mod",
    "t": "Towards the end of Overdressed, "
   },
   {
    "r": "sk",
    "t": "Cline introduced her ideal"
   },
   {
    "r": "mod",
    "t": ", a Brooklyn woman named Sarah Kate Beaumont, "
   },
   {
    "r": "cl",
    "t": "who since 2008 has made all of her own clothes"
   },
   {
    "r": "mod",
    "t": " – and beautifully."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "Cline introduced her ideal"
   },
   {
    "k": "介词状语",
    "t": "Towards the end of Overdressed"
   },
   {
    "k": "同位语",
    "t": "a Brooklyn woman named Sarah Kate Beaumont"
   },
   {
    "k": "非限制性定语从句",
    "t": "who since 2008 has made all of her own clothes"
   },
   {
    "k": "插入补充",
    "t": "– and beautifully（= and made them beautifully）"
   }
  ],
  "translation": "在《过度着装》一书接近结尾处，克莱因介绍了她心目中的典范：一位名叫莎拉·凯特·博蒙特的布鲁克林女士，她从 2008 年起就自己缝制所有衣服——而且做得非常漂亮。",
  "tips": [
   "her ideal 后的 a Brooklyn woman … 是同位语，进一步说明 ideal 是谁。",
   "named … 为过去分词后置定语；who 引导非限制性定语从句，时态用现在完成时（since 2008）。",
   "破折号后的 and beautifully 是省略结构，补全为 and (has made them) beautifully。"
  ]
 },
 {
  "id": "en1-2013-dnt",
  "source": "英语一 · 2013 · Text 2",
  "text": "If it is trying to upset Google, which relies almost wholly on advertising, it has chosen an indirect method: there is no guarantee that DNT by default will become the norm.",
  "segments": [
   {
    "r": "cl",
    "t": "If it is trying to upset Google"
   },
   {
    "r": "cl",
    "t": ", which relies almost wholly on advertising, "
   },
   {
    "r": "sk",
    "t": "it has chosen an indirect method"
   },
   {
    "r": "mod",
    "t": ": "
   },
   {
    "r": "cl",
    "t": "there is no guarantee that DNT by default will become the norm."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "it has chosen an indirect method"
   },
   {
    "k": "条件状语从句",
    "t": "If it is trying to upset Google"
   },
   {
    "k": "非限制性定语从句",
    "t": "which relies almost wholly on advertising"
   },
   {
    "k": "冒号解释",
    "t": "there is no guarantee that …"
   },
   {
    "k": "同位语从句",
    "t": "that DNT by default will become the norm"
   }
  ],
  "translation": "如果说它（微软）是想让主要依赖广告收入的谷歌难受，那么它选择的却是一种间接手段：无法保证默认开启的“禁止追踪”会成为行业规范。",
  "tips": [
   "句首 If 条件从句先出现，主干 it has chosen … 在中段，读句子要先跳过从句抓主谓宾。",
   "which 引导非限制性定语从句，补充说明 Google 的商业模式。",
   "that 从句作 guarantee 的同位语（不是定语）：说明“保证”的内容；判断方法是 that 不作成分、只陈述事实。"
  ]
 },
 {
  "id": "en1-2016-whereas",
  "source": "英语一 · 2016 · Text 3",
  "text": "In all, the study concludes that whereas prosecutors should only evaluate a case based on its merits, they do seem to be influenced by a company's record in CSR.",
  "segments": [
   {
    "r": "mod",
    "t": "In all, "
   },
   {
    "r": "sk",
    "t": "the study concludes "
   },
   {
    "r": "cl",
    "t": "that whereas prosecutors should only evaluate a case based on its merits, they do seem to be influenced by a company's record in CSR."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "the study concludes …"
   },
   {
    "k": "宾语从句",
    "t": "that whereas …, they do seem …"
   },
   {
    "k": "让步对比从句",
    "t": "whereas prosecutors should only evaluate a case based on its merits"
   },
   {
    "k": "从句主干",
    "t": "they do seem to be influenced by a company's record in CSR"
   }
  ],
  "translation": "总而言之，该研究得出结论：尽管检察官理应只根据案情本身来评估案件，但他们实际上似乎会受到企业社会责任记录的影响。",
  "tips": [
   "that 引导宾语从句，整个后半句都是 concludes 的内容。",
   "whereas = whereas/while，引导对比（含让步）状语从句，常译“然而/尽管”。",
   "do 在 do seem 中表强调，译为“确实/实际上”。",
   "based on its merits 为过去分词短语，作方式/依据状语。"
  ]
 },
 {
  "id": "en1-2017-ethics",
  "source": "英语一 · 2017 · Text 4",
  "text": "But it did so while holding its nose at the ethics of his conduct, which included accepting gifts such as a Rolex watch and a Ferrari automobile from a company seeking access to government.",
  "segments": [
   {
    "r": "sk",
    "t": "But it did so"
   },
   {
    "r": "mod",
    "t": " while holding its nose at the ethics of his conduct, "
   },
   {
    "r": "cl",
    "t": "which included accepting gifts such as a Rolex watch and a Ferrari automobile from a company seeking access to government."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "But it did so"
   },
   {
    "k": "时间/伴随状语（非谓语）",
    "t": "while holding its nose at the ethics of his conduct"
   },
   {
    "k": "非限制性定语从句",
    "t": "which included accepting gifts …"
   },
   {
    "k": "举例",
    "t": "such as a Rolex watch and a Ferrari automobile"
   },
   {
    "k": "后置定语",
    "t": "seeking access to government（修饰 a company）"
   }
  ],
  "translation": "但最高法院在这样做时，对他的行为操守嗤之以鼻——其中包括从一家试图接近政府的企业收受劳力士手表、法拉利汽车等礼品。",
  "tips": [
   "did so 是替代结构，指代前文提到的某个动作，避免重复。",
   "while holding … = while it was holding …，while + 分词省略主语。",
   "hold one's nose at … 字面“捏着鼻子”，引申为“强忍反感去做/对……不满却仍……”。",
   "which 指代 the ethics of his conduct；seeking … 为现在分词后置定语修饰 a company。"
  ]
 },
 {
  "id": "en1-2018-senate",
  "source": "英语一 · 2018 · Text 4",
  "text": "If it clears the House, this measure would still have to get through the Senate – where someone is bound to point out that it amounts to the bare, bare minimum necessary to keep the Postal Service afloat, not comprehensive reform.",
  "segments": [
   {
    "r": "cl",
    "t": "If it clears the House, "
   },
   {
    "r": "sk",
    "t": "this measure would still have to get through the Senate"
   },
   {
    "r": "mod",
    "t": " – "
   },
   {
    "r": "cl",
    "t": "where someone is bound to point out that it amounts to the bare, bare minimum necessary to keep the Postal Service afloat, not comprehensive reform."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "this measure would still have to get through the Senate"
   },
   {
    "k": "条件状语从句",
    "t": "If it clears the House"
   },
   {
    "k": "非限制性定语从句",
    "t": "where someone is bound to point out …"
   },
   {
    "k": "宾语从句",
    "t": "that it amounts to the bare, bare minimum …, not comprehensive reform"
   },
   {
    "k": "不定式后置定语",
    "t": "(which is) necessary to keep the Postal Service afloat"
   }
  ],
  "translation": "即使这一法案在众议院获得通过，它仍须闯过参议院这一关——到那时一定会有人指出：它不过是维持邮政系统运转所需的最低限度措施，而非全面改革。",
  "tips": [
   "clears the House 中 clear 是动词“使通过（议案）”，不是形容词。",
   "where 引导非限制性定语从句，相当于 in the Senate，补充说明参议院会发生什么。",
   "be bound to do = 一定会做；amount to = 等同于、实际上就是。",
   "necessary to keep … 前省略了 which is；not comprehensive reform 与 the bare minimum 并列对照。"
  ]
 },
 {
  "id": "en1-2019-sales-tax",
  "source": "英语一 · 2019 · Text 4",
  "text": "The cases the court overturned said that if a business was shipping a customer's purchase to a state where the business didn't have a physical presence such as a warehouse or office, the business didn't have to collect sales tax for the state.",
  "segments": [
   {
    "r": "sk",
    "t": "The cases the court overturned said"
   },
   {
    "r": "cl",
    "t": " that if a business was shipping a customer's purchase to a state where the business didn't have a physical presence such as a warehouse or office, the business didn't have to collect sales tax for the state."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "The cases … said …"
   },
   {
    "k": "定语从句（省略 that）",
    "t": "(that) the court overturned 修饰 The cases"
   },
   {
    "k": "宾语从句",
    "t": "that … the business didn't have to collect sales tax for the state"
   },
   {
    "k": "条件状语从句",
    "t": "if a business was shipping a customer's purchase to a state …"
   },
   {
    "k": "定语从句",
    "t": "where the business didn't have a physical presence"
   },
   {
    "k": "举例",
    "t": "such as a warehouse or office"
   }
  ],
  "translation": "被最高法院推翻的那些判例曾认定：如果一家企业把顾客购买的商品运往某个该企业并无实体存在的州（如仓库或办公室），那么该企业就不必为该州代收销售税。",
  "tips": [
   "主语 The cases 与谓语 said 之间插着省略 that 的定语从句 the court overturned。",
   "that 引导宾语从句；从句内部又套 if 条件从句，主句是 the business didn't have to …。",
   "where 引导定语从句修饰 a state，表示“在该州没有实体存在”。",
   "physical presence 指税法意义上的实体经营场所（nexus）。"
  ]
 },
 {
  "id": "en1-2020-gafa",
  "source": "英语一 · 2020 · Text 4",
  "text": "But it has already sparked significant controversy, with the United States trade representative opening an investigation into whether the tax discriminates against American companies, which in turn could lead to trade sanctions against France.",
  "segments": [
   {
    "r": "sk",
    "t": "But it has already sparked significant controversy"
   },
   {
    "r": "mod",
    "t": ", with the United States trade representative opening an investigation into "
   },
   {
    "r": "cl",
    "t": "whether the tax discriminates against American companies"
   },
   {
    "r": "cl",
    "t": ", which in turn could lead to trade sanctions against France."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "But it has already sparked significant controversy"
   },
   {
    "k": "with 复合结构（伴随）",
    "t": "with the United States trade representative opening an investigation …"
   },
   {
    "k": "介词宾语从句",
    "t": "whether the tax discriminates against American companies"
   },
   {
    "k": "非限制性定语从句",
    "t": "which in turn could lead to trade sanctions against France"
   }
  ],
  "translation": "但该税已引发重大争议：美国贸易代表已就这项税是否歧视美国企业展开调查，而这反过来又可能导致对法国的贸易制裁。",
  "tips": [
   "with + 名词 + 现在分词 是独立主格/伴随结构，补充说明 controversy 的具体表现。",
   "whether 引导介词 into 的宾语从句，译为“是否”。",
   "which 指代前面整件事（调查/争议）；in turn = 反过来、继而。",
   "discriminate against = 歧视、区别对待。"
  ]
 },
 {
  "id": "en1-2022-ferreira",
  "source": "英语一 · 2022 · Text 1",
  "text": "Joana Lia Ferreira, an assistant professor of conservation and restoration at the NOVA School of Science and Technology, notes that archaeologists first defined the great material ages of human history—Stone Age, Iron Age, and so on—after examining artifacts in museums.",
  "segments": [
   {
    "r": "sk",
    "t": "Joana Lia Ferreira"
   },
   {
    "r": "mod",
    "t": ", an assistant professor of conservation and restoration at the NOVA School of Science and Technology, "
   },
   {
    "r": "sk",
    "t": "notes "
   },
   {
    "r": "cl",
    "t": "that archaeologists first defined the great material ages of human history"
   },
   {
    "r": "mod",
    "t": "—Stone Age, Iron Age, and so on—"
   },
   {
    "r": "mod",
    "t": "after examining artifacts in museums."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "Joana Lia Ferreira notes that …"
   },
   {
    "k": "同位语（头衔）",
    "t": "an assistant professor … at the NOVA School …"
   },
   {
    "k": "宾语从句",
    "t": "that archaeologists first defined the great material ages of human history"
   },
   {
    "k": "插入举例",
    "t": "—Stone Age, Iron Age, and so on—"
   },
   {
    "k": "时间状语（非谓语）",
    "t": "after examining artifacts in museums（= after they examined …）"
   }
  ],
  "translation": "新星科技学院文物保护与修复专业的助理教授若昂娜·利亚·费雷拉指出：考古学家是在研究了博物馆中的文物之后，才首次界定了人类历史上几个伟大的材料时代——石器时代、铁器时代，等等。",
  "tips": [
   "主谓被长同位语隔开：Ferreira … notes，先找动词 notes 再回看主语。",
   "that 引导宾语从句；两个破折号之间是插入举例，读主干时可先跳过。",
   "after examining … 是“介词 + 动名词”，逻辑主语是 archaeologists，相当于 after they examined …。"
  ]
 },
 {
  "id": "en1-2023-hayden",
  "source": "英语一 · 2023 · Text 2",
  "text": "Weeks after completing the expedition, Hayden collected his team's observations into an extensive report aimed at convincing senators and representatives, along with colleagues at government agencies like the Department of the Interior, that Yellowstone ought to be preserved.",
  "segments": [
   {
    "r": "mod",
    "t": "Weeks after completing the expedition, "
   },
   {
    "r": "sk",
    "t": "Hayden collected his team's observations into an extensive report"
   },
   {
    "r": "mod",
    "t": " aimed at convincing senators and representatives, along with colleagues at government agencies like the Department of the Interior, "
   },
   {
    "r": "cl",
    "t": "that Yellowstone ought to be preserved."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "Hayden collected his team's observations into an extensive report"
   },
   {
    "k": "时间状语",
    "t": "Weeks after completing the expedition"
   },
   {
    "k": "过去分词后置定语",
    "t": "aimed at convincing senators and representatives … that …"
   },
   {
    "k": "插入并列",
    "t": "along with colleagues at government agencies like the Department of the Interior"
   },
   {
    "k": "宾语从句",
    "t": "that Yellowstone ought to be preserved（convince sb. that …）"
   }
  ],
  "translation": "考察结束数周后，海登将团队的观测资料汇编成一份详尽报告，旨在说服参众两院议员以及内政部等政府机构的同僚：黄石地区应当被保护起来。",
  "tips": [
   "collect A into B = 把 A 汇编进 B。",
   "aimed at convincing … 是过去分词定语；convince 的结构是 convince sb. that …，sb. 很长（含 along with 插入），that 从句隔得很远。",
   "ought to be preserved 为被动 + 情态，译“应当被保护”。"
  ]
 },
 {
  "id": "en1-2024-hunter",
  "source": "英语一 · 2024 · Text 1",
  "text": "While hunter-gatherer children learnt from observation and imitation in mixed-age playgroups, researchers said that western \"instructive teaching\", where pupils are asked to sit still, may contribute to conditions such as attention deficit hyperactivity disorder.",
  "segments": [
   {
    "r": "cl",
    "t": "While hunter-gatherer children learnt from observation and imitation in mixed-age playgroups, "
   },
   {
    "r": "sk",
    "t": "researchers said "
   },
   {
    "r": "cl",
    "t": "that western \"instructive teaching\", where pupils are asked to sit still, may contribute to conditions such as attention deficit hyperactivity disorder."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "researchers said …"
   },
   {
    "k": "让步/对比状语从句",
    "t": "While hunter-gatherer children learnt from observation and imitation …"
   },
   {
    "k": "宾语从句",
    "t": "that western \"instructive teaching\" … may contribute to conditions …"
   },
   {
    "k": "非限制性定语从句",
    "t": "where pupils are asked to sit still"
   },
   {
    "k": "举例",
    "t": "such as attention deficit hyperactivity disorder"
   }
  ],
  "translation": "狩猎采集社会的儿童在混龄玩耍中通过观察与模仿学习，而研究人员称，西方那种要求学生端坐的“指令式教学”，可能会引发注意缺陷多动障碍等问题。",
  "tips": [
   "While 在此表对比（“而/尽管”），不是单纯的时间“当……时”。",
   "that 从句主语是 western \"instructive teaching\"，谓语是 may contribute；中间插入 where 从句，别把 pupils 当主句主语。",
   "where 相当于 in which，修饰 teaching 这种教学方式。"
  ]
 },
 {
  "id": "en1-2025-shakespeare",
  "source": "英语一 · 2025 · Text 2",
  "text": "O'Hanlon said more research would be needed but suggested that Shakespeare's use of 20,000 words, compared with the everyday 2,000 words, gave a \"massive expansion of language into children's lives\", which was combined with children \"using their whole bodies to bring words to life\".",
  "segments": [
   {
    "r": "sk",
    "t": "O'Hanlon said more research would be needed "
   },
   {
    "r": "sk",
    "t": "but suggested "
   },
   {
    "r": "cl",
    "t": "that Shakespeare's use of 20,000 words"
   },
   {
    "r": "mod",
    "t": ", compared with the everyday 2,000 words, "
   },
   {
    "r": "cl",
    "t": "gave a \"massive expansion of language into children's lives\""
   },
   {
    "r": "cl",
    "t": ", which was combined with children \"using their whole bodies to bring words to life\"."
   }
  ],
  "structure": [
   {
    "k": "主干（并列谓语）",
    "t": "O'Hanlon said … but suggested …"
   },
   {
    "k": "宾语从句①（省略 that）",
    "t": "(that) more research would be needed"
   },
   {
    "k": "宾语从句②",
    "t": "that Shakespeare's use of 20,000 words … gave a \"massive expansion …\""
   },
   {
    "k": "插入比较",
    "t": "compared with the everyday 2,000 words"
   },
   {
    "k": "非限制性定语从句",
    "t": "which was combined with children \"using their whole bodies …\""
   }
  ],
  "translation": "奥汉隆说还需要更多研究，但他指出：莎士比亚使用的两万词汇（相较日常的两千词）极大地拓展了儿童生活中的语言；这又与儿童“用整个身体把词语鲜活地表现出来”相结合。",
  "tips": [
   "said 与 suggested 为并列谓语；said 后省略 that，suggested 后保留 that。",
   "compared with … 是插入的过去分词短语，补充比较对象。",
   "which 指代前面“词汇拓展”这一整体现象；was combined with 为被动，译“与……结合”。"
  ]
 },
 {
  "id": "en2-2011-co2",
  "source": "英语二 · 2011 · Text 3",
  "text": "While producing large quantities of CO2, these computers emit a great deal of heat, so the centres need to be well air-conditioned, which uses even more energy.",
  "segments": [
   {
    "r": "mod",
    "t": "While producing large quantities of CO2, "
   },
   {
    "r": "sk",
    "t": "these computers emit a great deal of heat"
   },
   {
    "r": "cl",
    "t": ", so the centres need to be well air-conditioned"
   },
   {
    "r": "cl",
    "t": ", which uses even more energy."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "these computers emit a great deal of heat"
   },
   {
    "k": "时间/伴随状语（非谓语）",
    "t": "While producing large quantities of CO2"
   },
   {
    "k": "结果状语从句",
    "t": "so the centres need to be well air-conditioned"
   },
   {
    "k": "非限制性定语从句",
    "t": "which uses even more energy"
   }
  ],
  "translation": "这些计算机在产生大量二氧化碳的同时，还散发出巨大热量，因此数据中心必须配备良好的空调——而这又消耗更多能源。",
  "tips": [
   "While producing … = While they are producing …，主语与主句一致故省略。",
   "so 引导结果分句；句尾 which 指代“开空调降温”整件事，不是单指 centres。",
   "need to be well air-conditioned 为被动不定式。"
  ]
 },
 {
  "id": "en2-2012-pink",
  "source": "英语二 · 2012 · Text 2",
  "text": "When nursery colours were introduced, pink was actually considered the more masculine colour, a pastel version of red, which was associated with strength.",
  "segments": [
   {
    "r": "cl",
    "t": "When nursery colours were introduced, "
   },
   {
    "r": "sk",
    "t": "pink was actually considered the more masculine colour"
   },
   {
    "r": "mod",
    "t": ", a pastel version of red, "
   },
   {
    "r": "cl",
    "t": "which was associated with strength."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "pink was actually considered the more masculine colour"
   },
   {
    "k": "时间状语从句",
    "t": "When nursery colours were introduced"
   },
   {
    "k": "同位语",
    "t": "a pastel version of red"
   },
   {
    "k": "非限制性定语从句",
    "t": "which was associated with strength"
   }
  ],
  "translation": "育儿配色刚出现时，粉色实际上被视为更具男性气质的颜色——它是红色的柔和版，而红色与力量相关联。",
  "tips": [
   "consider A (to be) B：这里用被动 was considered the more masculine colour，the more masculine colour 是主语补足语。",
   "a pastel version of red 作同位语，解释 pink；后接 which 非限制性从句（语法上更贴近 red）。",
   "be associated with = 与……相关联。"
  ]
 },
 {
  "id": "en2-2015-cortisol",
  "source": "英语二 · 2015 · Text 2",
  "text": "Researchers measured people's cortisol, which is a stress marker, while they were at work and while they were at home and found it higher at what is supposed to be a place of refuge.",
  "segments": [
   {
    "r": "sk",
    "t": "Researchers measured people's cortisol"
   },
   {
    "r": "cl",
    "t": ", which is a stress marker, "
   },
   {
    "r": "mod",
    "t": "while they were at work and while they were at home"
   },
   {
    "r": "sk",
    "t": " and found it higher at "
   },
   {
    "r": "cl",
    "t": "what is supposed to be a place of refuge."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "Researchers measured people's cortisol … and found it higher …"
   },
   {
    "k": "非限制性定语从句（插入）",
    "t": "which is a stress marker"
   },
   {
    "k": "时间状语从句（并列）",
    "t": "while they were at work and while they were at home"
   },
   {
    "k": "介词宾语从句",
    "t": "what is supposed to be a place of refuge（= the place that …）"
   }
  ],
  "translation": "研究人员测量了人们体内的皮质醇（一种压力标志物），分别在工作时和在家时测量，结果发现皮质醇在本应是避风港的地方反而更高。",
  "tips": [
   "measured … and found … 为并列谓语，共享主语 Researchers。",
   "which is a stress marker 插入补充 cortisol，读主干时可先跳过。",
   "what is supposed to be … = the thing/place that is supposed to be …，what 名词性从句作介词 at 的宾语。"
  ]
 },
 {
  "id": "en2-2016-coding",
  "source": "英语二 · 2016 · Text 1",
  "text": "Students also benefit from learning something about coding before they get to college, where introductory computer-science classes are packed to the brim, which can drive the less-experienced or less-determined students away.",
  "segments": [
   {
    "r": "sk",
    "t": "Students also benefit from learning something about coding"
   },
   {
    "r": "cl",
    "t": " before they get to college"
   },
   {
    "r": "cl",
    "t": ", where introductory computer-science classes are packed to the brim, "
   },
   {
    "r": "cl",
    "t": "which can drive the less-experienced or less-determined students away."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "Students also benefit from learning something about coding"
   },
   {
    "k": "时间状语从句",
    "t": "before they get to college"
   },
   {
    "k": "非限制性定语从句",
    "t": "where introductory computer-science classes are packed to the brim"
   },
   {
    "k": "非限制性定语从句",
    "t": "which can drive the less-experienced or less-determined students away"
   }
  ],
  "translation": "学生在进入大学之前学一点编程也有好处：大学里的计算机导论课往往人满为患，这可能会把经验不足或决心不够的学生吓退。",
  "tips": [
   "benefit from doing；learning about coding 是动名词短语。",
   "where 修饰 college（在大学里）；which 修饰前面整句现象（课满导致挤走学生）。",
   "packed to the brim = 塞满；drive … away = 把……赶走/吓退。",
   "两个逗号从句连环，先抓主干 Students benefit，再挂 before / where / which。"
  ]
 },
 {
  "id": "en2-2017-parents",
  "source": "英语二 · 2017 · Text 2",
  "text": "But to win over these young workers, manufacturers have to clear another major hurdle: parents, who lived through the worst US economic downturn since the Great Depression, telling them to avoid the factory.",
  "segments": [
   {
    "r": "mod",
    "t": "But to win over these young workers, "
   },
   {
    "r": "sk",
    "t": "manufacturers have to clear another major hurdle"
   },
   {
    "r": "mod",
    "t": ": "
   },
   {
    "r": "sk",
    "t": "parents"
   },
   {
    "r": "cl",
    "t": ", who lived through the worst US economic downturn since the Great Depression, "
   },
   {
    "r": "mod",
    "t": "telling them to avoid the factory."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "manufacturers have to clear another major hurdle"
   },
   {
    "k": "目的状语",
    "t": "to win over these young workers"
   },
   {
    "k": "冒号同位/说明",
    "t": "parents（= the hurdle is parents）"
   },
   {
    "k": "非限制性定语从句",
    "t": "who lived through the worst US economic downturn since the Great Depression"
   },
   {
    "k": "现在分词补充",
    "t": "telling them to avoid the factory"
   }
  ],
  "translation": "但要说服这些年轻工人，制造商还得跨过另一道主要障碍：他们的父母——那些经历过大萧条以来最严重经济衰退的人——会劝他们别进工厂。",
  "tips": [
   "clear a hurdle = 跨过障碍；hurdle 的同位语是 parents，冒号引出解释。",
   "who 从句修饰 parents；telling … 是 parents 的伴随动作（parents telling them … 独立结构式补充）。",
   "win over = 说服、争取；live through = 经历过。"
  ]
 },
 {
  "id": "en2-2018-working-class",
  "source": "英语二 · 2018 · Text 4",
  "text": "In other words, at a time when the working class has turned the country on its political head, frustrated that the opportunity that once defined America is vanishing, one obvious solution is staring us in the face.",
  "segments": [
   {
    "r": "mod",
    "t": "In other words, "
   },
   {
    "r": "mod",
    "t": "at a time when the working class has turned the country on its political head, "
   },
   {
    "r": "mod",
    "t": "frustrated that the opportunity that once defined America is vanishing, "
   },
   {
    "r": "sk",
    "t": "one obvious solution is staring us in the face."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "one obvious solution is staring us in the face"
   },
   {
    "k": "过渡语",
    "t": "In other words"
   },
   {
    "k": "介词 + 定语从句",
    "t": "at a time when the working class has turned the country on its political head"
   },
   {
    "k": "形容词短语（原因）",
    "t": "frustrated that the opportunity … is vanishing"
   },
   {
    "k": "定语从句（省略 that）",
    "t": "(that) once defined America 修饰 the opportunity"
   }
  ],
  "translation": "换句话说，在工人阶级已在政治上把国家翻了个个儿、因曾经定义美国的机会正在消逝而感到沮丧之时，一个显而易见的解决办法就摆在我们眼前。",
  "tips": [
   "真正主干在句尾：one obvious solution is staring us in the face，前面全是状语。",
   "when 引导定语从句修饰 a time。",
   "frustrated that … 是形容词 + that 从句，表示原因，逻辑主语是 the working class。",
   "the opportunity that once defined America：that 从句修饰 opportunity；is vanishing 是 frustrated 的宾语从句谓语。"
  ]
 },
 {
  "id": "en2-2021-land",
  "source": "英语二 · 2021 · Text 3",
  "text": "Even if we converted all the suitable land to fields of fruit and veg—which would involve taking out all the nature reserves and removing thousands of people from their homes—we would achieve only a 30 per cent boost in crop production.",
  "segments": [
   {
    "r": "cl",
    "t": "Even if we converted all the suitable land to fields of fruit and veg"
   },
   {
    "r": "mod",
    "t": "—which would involve taking out all the nature reserves and removing thousands of people from their homes—"
   },
   {
    "r": "sk",
    "t": "we would achieve only a 30 per cent boost in crop production."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "we would achieve only a 30 per cent boost in crop production"
   },
   {
    "k": "让步条件从句",
    "t": "Even if we converted all the suitable land to fields of fruit and veg"
   },
   {
    "k": "插入语（非限制性定语）",
    "t": "which would involve taking out … and removing …"
   }
  ],
  "translation": "即使我们把所有适宜的土地都改成果蔬农田——这还得拆掉全部自然保护区、让成千上万人搬离家园——作物产量也只能提高 30%。",
  "tips": [
   "Even if 引导让步条件从句；主句用 would achieve（虚拟/让步结果）。",
   "两个破折号之间是插入的非限制性定语从句，补充“这样做”的代价，读句子时可先摘掉。",
   "involve doing；take out = 拆除；convert A to B = 把 A 转为 B。"
  ]
 },
 {
  "id": "en2-2022-nest-eggs",
  "source": "英语二 · 2022 · Text 1",
  "text": "Because of longer life spans, Americans are also boosting their savings to preserve their nest eggs, the TD Ameritrade study showed, which surveyed 2000 adults between 40 and 79.",
  "segments": [
   {
    "r": "mod",
    "t": "Because of longer life spans, "
   },
   {
    "r": "sk",
    "t": "Americans are also boosting their savings to preserve their nest eggs"
   },
   {
    "r": "mod",
    "t": ", the TD Ameritrade study showed, "
   },
   {
    "r": "cl",
    "t": "which surveyed 2000 adults between 40 and 79."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "Americans are also boosting their savings to preserve their nest eggs"
   },
   {
    "k": "原因状语",
    "t": "Because of longer life spans"
   },
   {
    "k": "插入语（信息来源）",
    "t": "the TD Ameritrade study showed"
   },
   {
    "k": "非限制性定语从句",
    "t": "which surveyed 2000 adults between 40 and 79"
   }
  ],
  "translation": "由于寿命延长，美国人也在增加储蓄以保住自己的养老本钱——TD Ameritrade 的研究显示了这一点；该研究调查了 2000 名 40 至 79 岁的成年人。",
  "tips": [
   "叙述句中插入 the study showed 作信息来源，类似“据……显示”，主干是 Americans are boosting …。",
   "which 指代 the TD Ameritrade study，不是 nest eggs。",
   "nest eggs 本义“孵蛋的窝蛋”，引申为“养老积蓄/老本”。"
  ]
 },
 {
  "id": "old-1998-workplace",
  "source": "旧题型 · 1998 · Text 2",
  "text": "New ways of organizing the workplace—all that re-engineering and downsizing—are only one contribution to the overall productivity of an economy, which is driven by many other factors such as joint investment in equipment and machinery, new technology, and investment in education and training.",
  "segments": [
   {
    "r": "sk",
    "t": "New ways of organizing the workplace"
   },
   {
    "r": "mod",
    "t": "—all that re-engineering and downsizing—"
   },
   {
    "r": "sk",
    "t": "are only one contribution to the overall productivity of an economy"
   },
   {
    "r": "cl",
    "t": ", which is driven by many other factors such as joint investment in equipment and machinery, new technology, and investment in education and training."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "New ways … are only one contribution to the overall productivity of an economy"
   },
   {
    "k": "破折号插入（同位说明）",
    "t": "all that re-engineering and downsizing"
   },
   {
    "k": "非限制性定语从句",
    "t": "which is driven by many other factors"
   },
   {
    "k": "举例并列",
    "t": "such as joint investment …, new technology, and investment in education and training"
   }
  ],
  "translation": "组织工作场所的新方式——所有那些“流程再造”与裁员——只是提升一国经济整体生产率的诸多因素之一；生产率还受许多其他因素驱动，例如对设备与机械的共同投资、新技术，以及教育与培训投入。",
  "tips": [
   "主语 New ways 与谓语 are 被破折号插入语隔开；of organizing … 为介词定语。",
   "which 指代 the overall productivity of an economy（而非 economy 或 ways）。",
   "be driven by = 由……驱动；such as 后接三个并列名词短语。"
  ]
 },
 {
  "id": "old-1999-warnings",
  "source": "旧题型 · 1999 · Text 1",
  "text": "While warnings are often appropriate and necessary—the dangers of drug interactions, for example—and many are required by state or federal regulations, it isn't clear that they actually protect the manufacturers and sellers from liability if a customer is injured.",
  "segments": [
   {
    "r": "cl",
    "t": "While warnings are often appropriate and necessary"
   },
   {
    "r": "mod",
    "t": "—the dangers of drug interactions, for example—"
   },
   {
    "r": "cl",
    "t": "and many are required by state or federal regulations, "
   },
   {
    "r": "sk",
    "t": "it isn't clear "
   },
   {
    "r": "cl",
    "t": "that they actually protect the manufacturers and sellers from liability"
   },
   {
    "r": "cl",
    "t": " if a customer is injured."
   }
  ],
  "structure": [
   {
    "k": "主干（形式主语）",
    "t": "it isn't clear that …"
   },
   {
    "k": "让步状语从句",
    "t": "While warnings are often appropriate and necessary … and many are required …"
   },
   {
    "k": "插入举例",
    "t": "—the dangers of drug interactions, for example—"
   },
   {
    "k": "主语从句",
    "t": "that they actually protect the manufacturers and sellers from liability"
   },
   {
    "k": "条件状语从句",
    "t": "if a customer is injured"
   }
  ],
  "translation": "虽然警示往往恰当且必要——例如药物相互作用的危险——且许多警示是州或联邦法规所要求的，但一旦顾客受伤，它们是否真能保护制造商与销售商免于担责，却并不清楚。",
  "tips": [
   "While 引导让步从句；从句内部用 and 连接两个分句，中间再插入破折号举例。",
   "it 是形式主语，真正主语是 that 从句。",
   "protect sb. from liability = 保护某人免于承担责任。"
  ]
 },
 {
  "id": "old-2000-semiconductors",
  "source": "旧题型 · 2000 · Text 1",
  "text": "For a while it looked as though the making of semiconductors, which America had invented and which sat at the heart of the new computer age, was going to be the next casualty.",
  "segments": [
   {
    "r": "mod",
    "t": "For a while "
   },
   {
    "r": "sk",
    "t": "it looked "
   },
   {
    "r": "cl",
    "t": "as though the making of semiconductors"
   },
   {
    "r": "cl",
    "t": ", which America had invented and which sat at the heart of the new computer age, "
   },
   {
    "r": "cl",
    "t": "was going to be the next casualty."
   }
  ],
  "structure": [
   {
    "k": "主干（形式主语）",
    "t": "it looked as though …"
   },
   {
    "k": "表语从句",
    "t": "as though the making of semiconductors … was going to be the next casualty"
   },
   {
    "k": "并列非限制性定语从句",
    "t": "which America had invented and which sat at the heart of the new computer age"
   }
  ],
  "translation": "有那么一阵子，情况看上去仿佛半导体制造业——美国发明了它、且它又处在新计算机时代核心——将成为下一个牺牲品。",
  "tips": [
   "it looked as though … 中 it 为形式主语，as though 从句是真正主语/表语内容。",
   "两个 which 从句并列，都修饰 the making of semiconductors（也可理解为 semiconductors）。",
   "casualty 本义“伤亡者”，此处喻指“被淘汰/受重创的对象”。"
  ]
 },
 {
  "id": "old-2002-lunch",
  "source": "旧题型 · 2002 · Text 1",
  "text": "Everyone is very peaceful, polite and friendly until, waiting in a line for lunch, the new arrival is suddenly pushed aside by a man in a white coat, who rushes to the head of the line, grabs his food and stomps over to a table by himself.",
  "segments": [
   {
    "r": "sk",
    "t": "Everyone is very peaceful, polite and friendly"
   },
   {
    "r": "cl",
    "t": " until, waiting in a line for lunch, the new arrival is suddenly pushed aside by a man in a white coat"
   },
   {
    "r": "cl",
    "t": ", who rushes to the head of the line, grabs his food and stomps over to a table by himself."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "Everyone is very peaceful, polite and friendly"
   },
   {
    "k": "时间状语从句",
    "t": "until … the new arrival is suddenly pushed aside …"
   },
   {
    "k": "插入分词短语",
    "t": "waiting in a line for lunch（= while waiting …）"
   },
   {
    "k": "非限制性定语从句",
    "t": "who rushes …, grabs … and stomps …（三个并列谓语）"
   }
  ],
  "translation": "每个人都非常平和、礼貌而友善——直到在排队等午餐时，新来者突然被一个穿白大褂的男人推到一边；那人冲到队伍最前面，抓起自己的食物，独自噔噔噔地走到一张桌旁。",
  "tips": [
   "until 引导时间从句，表示“一直……直到……才发生变化”。",
   "waiting in a line for lunch 是插入的现在分词短语，逻辑主语是 the new arrival。",
   "who 从句里 rushes / grabs / stomps 三个动词并列，共用 who。"
  ]
 },
 {
  "id": "old-2006-playgoers",
  "source": "旧题型 · 2006 · Text 4",
  "text": "It is the playgoers, the RSC contends, who bring in much of the town's revenue because they spend the night (some of them four or five nights) pouring cash into the hotels and restaurants.",
  "segments": [
   {
    "r": "sk",
    "t": "It is the playgoers"
   },
   {
    "r": "mod",
    "t": ", the RSC contends, "
   },
   {
    "r": "cl",
    "t": "who bring in much of the town's revenue"
   },
   {
    "r": "cl",
    "t": " because they spend the night (some of them four or five nights) pouring cash into the hotels and restaurants."
   }
  ],
  "structure": [
   {
    "k": "强调句主干",
    "t": "It is the playgoers who bring in much of the town's revenue"
   },
   {
    "k": "插入语（来源）",
    "t": "the RSC contends"
   },
   {
    "k": "原因状语从句",
    "t": "because they spend the night … pouring cash into …"
   },
   {
    "k": "括号补充",
    "t": "(some of them four or five nights)"
   }
  ],
  "translation": "皇家莎士比亚剧团认为，正是这些戏迷为该镇带来了大部分收入，因为他们在这里过夜（有些人一住就是四五夜），把钱大把花在酒店和餐馆里。",
  "tips": [
   "It is … who … 是强调句型，强调主语 the playgoers；去掉 It is / who 仍是完整句。",
   "the RSC contends 插在主谓之间，作信息来源。",
   "spend the night (in) doing；pouring cash into … 是 spend time doing 结构。"
  ]
 },
 {
  "id": "old-2008-washington",
  "source": "旧题型 · 2008 · Text 4",
  "text": "Washington, who had begun to believe that all men were created equal after observing the bravery of the black soldiers during the Revolutionary War, overcame the strong opposition of his relatives to grant his slaves their freedom in his will.",
  "segments": [
   {
    "r": "sk",
    "t": "Washington"
   },
   {
    "r": "cl",
    "t": ", who had begun to believe that all men were created equal after observing the bravery of the black soldiers during the Revolutionary War, "
   },
   {
    "r": "sk",
    "t": "overcame the strong opposition of his relatives to grant his slaves their freedom in his will."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "Washington overcame the strong opposition of his relatives"
   },
   {
    "k": "非限制性定语从句",
    "t": "who had begun to believe that all men were created equal …"
   },
   {
    "k": "宾语从句",
    "t": "that all men were created equal"
   },
   {
    "k": "时间状语（非谓语）",
    "t": "after observing the bravery of the black soldiers during the Revolutionary War"
   },
   {
    "k": "不定式（结果/目的）",
    "t": "to grant his slaves their freedom in his will"
   }
  ],
  "translation": "华盛顿在独立战争期间目睹黑人士兵的英勇之后，开始相信人人生而平等；他不顾亲人的强烈反对，在遗嘱中给予了他的奴隶们自由。",
  "tips": [
   "主语 Washington 与谓语 overcame 被超长 who 从句隔开——长难句最常见陷阱。",
   "that 从句作 believe 的宾语；after observing … 修饰 began/believe 的时间。",
   "to grant … 在此表结果（最终做到了）/目的；grant sb. sth. = 授予某人某物。"
  ]
 },
 {
  "id": "old-2009-ptk",
  "source": "旧题型 · 2009 · Text 2",
  "text": "More than 60,000 people have purchased the PTKs since they first became available without prescriptions last year, according to Doug Fogg, chief operating officer of Identigene, which makes the over-the-counter kits.",
  "segments": [
   {
    "r": "sk",
    "t": "More than 60,000 people have purchased the PTKs"
   },
   {
    "r": "cl",
    "t": " since they first became available without prescriptions last year"
   },
   {
    "r": "mod",
    "t": ", according to Doug Fogg, chief operating officer of Identigene, "
   },
   {
    "r": "cl",
    "t": "which makes the over-the-counter kits."
   }
  ],
  "structure": [
   {
    "k": "主干",
    "t": "More than 60,000 people have purchased the PTKs"
   },
   {
    "k": "时间状语从句",
    "t": "since they first became available without prescriptions last year"
   },
   {
    "k": "插入语（来源）",
    "t": "according to Doug Fogg"
   },
   {
    "k": "同位语",
    "t": "chief operating officer of Identigene"
   },
   {
    "k": "非限制性定语从句",
    "t": "which makes the over-the-counter kits"
   }
  ],
  "translation": "据 Identigene 公司首席运营官道格·福格介绍，自去年这些亲子鉴定试剂盒无需处方即可购买以来，已有六万多人购买；该公司生产这些非处方试剂盒。",
  "tips": [
   "PTKs = paternity testing kits，亲子鉴定试剂盒。",
   "according to … 插入在句尾，却修饰整个主句陈述的来源。",
   "chief operating officer of Identigene 是 Doug Fogg 的同位语。",
   "which 指代 Identigene（公司），不是 kits。"
  ]
 }
];
