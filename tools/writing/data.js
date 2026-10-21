// 考研英语作文模板与高分句型 · 内容数据
// 结构：letters 小作文模板 / essays 大作文模板 / sentences 高分句型库
window.WRITING_DATA = {
  letters: [
    {
      id: "suggestion",
      title: "建议信",
      en: "Letter of Suggestion",
      scene: "就图书馆、课程、校园设施、公共服务等提出改进建议（考研最高频）",
      skeleton: [
        { part: "开头", tip: "自我介绍（可选）+ 写信目的：提出建议" },
        { part: "主体", tip: "先简要指出问题/现状，再分点给出 2–3 条具体建议（每条一句）" },
        { part: "结尾", tip: "表达期望被采纳 + 致谢/礼貌收尾" }
      ],
      patterns: [
        {
          id: "suggestion-p1",
          en: "I am writing to put forward some suggestions concerning...",
          zh: "我写信是为了就……提出一些建议。",
          note: "concerning = about，比 about 更正式；空格处接名词或动名词。"
        },
        {
          id: "suggestion-p2",
          en: "It would be helpful / practical if you could...",
          zh: "如果贵方能……，将会很有帮助/很实用。",
          note: "委婉建议的万能句式，后接动词原形。"
        },
        {
          id: "suggestion-p3",
          en: "I suggest that... (should) be done / that we (should) do...",
          zh: "我建议……",
          note: "suggest 后接宾语从句时用虚拟语气，should 可省略。"
        },
        {
          id: "suggestion-p4",
          en: "One practical measure would be to...",
          zh: "一条切实可行的措施是……",
          note: "用来引出具体做法，比 we should 更有「措施感」。"
        },
        {
          id: "suggestion-p5",
          en: "I hope you will find these suggestions helpful and take them into consideration.",
          zh: "希望这些建议对您有所帮助，并予以考虑。",
          note: "收尾句；take into consideration = 考虑，比 consider 更书面。"
        }
      ],
      sample: {
        title: "关于改进图书馆服务的建议信",
        body: "Dear Sir or Madam,\n\nI am a senior student and I am writing to put forward some suggestions concerning the library service.\n\nFirst, it would be helpful to extend the opening hours until ten p.m. on weekdays, because many students can only study after classes. Second, I suggest that more power sockets be installed in the reading rooms, as laptops have become essential for academic work. Finally, a simple online booking system for group-study rooms would save us a great deal of time and trouble.\n\nI hope you will find these suggestions practical. Thank you for your attention.\n\nYours sincerely,\nLi Ming"
      }
    },
    {
      id: "invitation",
      title: "邀请信",
      en: "Letter of Invitation",
      scene: "邀请教授、外宾、校友做讲座/参加活动/担任评委",
      skeleton: [
        { part: "开头", tip: "表明身份 + 发出邀请（写清邀请对方做什么）" },
        { part: "主体", tip: "活动细节：时间、地点、内容、受众；说明为何邀请对方" },
        { part: "结尾", tip: "期待答复 + 表示可提供协助" }
      ],
      patterns: [
        {
          id: "invitation-p1",
          en: "I am writing to invite you to give a lecture / attend...",
          zh: "我写信是想邀请您来做讲座/出席……",
          note: "开门见山点明邀请事项，题目要求写清则必须写清。"
        },
        {
          id: "invitation-p2",
          en: "It would be our great honor if you could...",
          zh: "如蒙您……，我们将不胜荣幸。",
          note: "礼貌抬高对方；if you could 后接动词原形。"
        },
        {
          id: "invitation-p3",
          en: "The event is scheduled for 3 p.m. on June 12 in the school auditorium.",
          zh: "活动定于 6 月 12 日下午 3 点在学校礼堂举行。",
          note: "be scheduled for + 时间/地点；时间信息必须交代完整。"
        },
        {
          id: "invitation-p4",
          en: "We would be delighted if you could come and share your experience with us.",
          zh: "若您能前来与我们分享经验，我们将非常高兴。",
          note: "share experience / insight 是邀请学者时的高频搭配。"
        },
        {
          id: "invitation-p5",
          en: "Please let me know at your earliest convenience whether you can make it.",
          zh: "方便时请尽早告知您能否出席。",
          note: "at one’s earliest convenience 尽快；make it = 赶到/出席。"
        }
      ],
      sample: {
        title: "邀请外教参加英语角的邀请信",
        body: "Dear Professor Smith,\n\nI am writing to invite you to attend the English Corner held by our department. It would be our great honor if you could join us and share your experience with us.\n\nThe event is scheduled for 7 p.m. on Friday, November 8, in Room 302 of the Main Building. Around forty students majoring in English will take part, and we hope you could talk with us about campus life in Western universities for about thirty minutes.\n\nWe would be delighted if you could come. Please let me know at your earliest convenience whether you can make it.\n\nYours sincerely,\nLi Ming"
      }
    },
    {
      id: "complaint",
      title: "投诉信",
      en: "Letter of Complaint",
      scene: "对商品质量、服务态度、噪音扰民等表达不满并要求解决",
      skeleton: [
        { part: "开头", tip: "点明写信缘由（何时何地购买/遭遇何事）+ 表达不满" },
        { part: "主体", tip: "客观描述问题经过与造成的不便，避免情绪化谩骂" },
        { part: "结尾", tip: "提出合理解决方案 + 表达希望尽快处理" }
      ],
      patterns: [
        {
          id: "complaint-p1",
          en: "I am writing to express my dissatisfaction with...",
          zh: "我写信是为了表达对……的不满。",
          note: "dissatisfaction with + 名词；投诉信标准开头。"
        },
        {
          id: "complaint-p2",
          en: "The quality of... was far from satisfactory.",
          zh: "……的质量远不能令人满意。",
          note: "far from satisfactory 远非令人满意，比 very bad 得体。"
        },
        {
          id: "complaint-p3",
          en: "Much to my disappointment, the product I bought broke down after two days.",
          zh: "令我非常失望的是，我买的产品两天后就坏了。",
          note: "Much to my disappointment 放句首语气更强；可替换后半句内容。"
        },
        {
          id: "complaint-p4",
          en: "I would appreciate it if you could deal with this matter promptly and give me a full refund.",
          zh: "如能及时处理此事并全额退款，我将不胜感激。",
          note: "I would appreciate it if you could… 是提出要求的礼貌写法。"
        },
        {
          id: "complaint-p5",
          en: "I hope this matter will be resolved to my satisfaction.",
          zh: "希望此事能得到令我满意的解决。",
          note: "to one’s satisfaction 令某人满意；投诉信收尾常用。"
        }
      ],
      sample: {
        title: "关于网购耳机质量问题的投诉信",
        body: "Dear Sir or Madam,\n\nI am writing to express my dissatisfaction with a pair of headphones I bought from your online store last Friday.\n\nMuch to my disappointment, the product broke down after two days: the left earphone produced no sound at all. I have been a regular customer for years, and the quality was far from satisfactory. As a result, I had to borrow an old pair to prepare for my exams, which caused me great inconvenience.\n\nI would appreciate it if you could deal with this matter promptly and give me a full refund. I hope this matter will be resolved to my satisfaction.\n\nYours sincerely,\nLi Ming"
      }
    },
    {
      id: "thanks",
      title: "感谢信",
      en: "Letter of Thanks",
      scene: "感谢帮助过自己的老师、朋友、主办方、接待家庭",
      skeleton: [
        { part: "开头", tip: "点明写信目的：表示感谢（可点出具体帮助事项）" },
        { part: "主体", tip: "回忆对方的帮助及其对你的影响/意义" },
        { part: "结尾", tip: "再次致谢 + 表达祝愿或回报意愿" }
      ],
      patterns: [
        {
          id: "thanks-p1",
          en: "I am writing to express my heartfelt gratitude for...",
          zh: "我写信是为了表达对……由衷的感谢。",
          note: "heartfelt 衷心的；比 thank you for 更正式饱满。"
        },
        {
          id: "thanks-p2",
          en: "Your kindness and timely help meant a great deal to me.",
          zh: "您及时的善意帮助对我意义重大。",
          note: "mean a great deal / mean a lot to sb. 对某人意义重大。"
        },
        {
          id: "thanks-p3",
          en: "Had it not been for your assistance, I would not have...",
          zh: "若不是您的帮助，我就不会……",
          note: "虚拟倒装句，高分亮点；= If it had not been for... "
        },
        {
          id: "thanks-p4",
          en: "I could hardly finish the task without your generous support.",
          zh: "没有您的大力支持，我几乎无法完成任务。",
          note: "could hardly... without... 双重否定表示肯定。"
        },
        {
          id: "thanks-p5",
          en: "Please accept my sincere thanks, and I hope to repay you someday.",
          zh: "请接受我诚挚的谢意，希望日后能回报您。",
          note: "repay 回报；也可换成 wish you all the best。"
        }
      ],
      sample: {
        title: "感谢外教指导写作的感谢信",
        body: "Dear Professor Brown,\n\nI am writing to express my heartfelt gratitude for your generous help with my academic writing last month.\n\nYour kindness and timely help meant a great deal to me. Had it not been for your assistance, I would not have won the first prize in the essay contest. You spent two whole afternoons correcting my drafts and explaining how to build a clear argument, which has improved my writing greatly and will benefit me for years to come.\n\nPlease accept my sincere thanks, and I hope to repay you someday. I wish you every success in your future work.\n\nYours sincerely,\nLi Ming"
      }
    },
    {
      id: "apology",
      title: "道歉信",
      en: "Letter of Apology",
      scene: "未能赴约、未能按时交稿、损坏他人财物、缺席会议等",
      skeleton: [
        { part: "开头", tip: "直接道歉，点明因何事道歉" },
        { part: "主体", tip: "说明真实原因（简洁可信）+ 表达遗憾" },
        { part: "结尾", tip: "提出补救办法 + 再次致歉/请求原谅" }
      ],
      patterns: [
        {
          id: "apology-p1",
          en: "I am writing to apologize for...",
          zh: "我写信是为了就……向您道歉。",
          note: "apologize for + 名词/动名词，后面接具体过失。"
        },
        {
          id: "apology-p2",
          en: "I am terribly sorry that I have to cancel our appointment.",
          zh: "非常抱歉，我不得不取消我们的会面。",
          note: "terribly/dreadfully sorry 加强语气；that 从句说明情况。"
        },
        {
          id: "apology-p3",
          en: "The reason for my absence is that I was down with a sudden fever.",
          zh: "我缺席的原因是突然发烧病倒了。",
          note: "The reason for... is that...（不用 because）；be down with 病倒。"
        },
        {
          id: "apology-p4",
          en: "I sincerely hope you can understand my situation and accept my apology.",
          zh: "真诚希望您能理解我的处境并接受我的歉意。",
          note: "understand one’s situation 为对方「找台阶」，显得诚恳。"
        },
        {
          id: "apology-p5",
          en: "Please allow me to make up for it by...",
          zh: "请允许我通过……来弥补。",
          note: "make up for 弥补；后接具体补救措施，让道歉有行动。"
        }
      ],
      sample: {
        title: "因病缺席会议的道歉信",
        body: "Dear Mr. Wang,\n\nI am writing to apologize for my absence from the meeting scheduled for yesterday afternoon.\n\nI am terribly sorry that I could not be there. The reason for my absence is that I was down with a sudden fever and was advised by the doctor to stay in bed. I understand the meeting was important, and I feel very guilty for any trouble I may have caused.\n\nPlease allow me to make up for it by sending you a brief report tonight. I sincerely hope you can understand my situation and accept my apology.\n\nYours sincerely,\nLi Ming"
      }
    },
    {
      id: "recommendation",
      title: "推荐信",
      en: "Letter of Recommendation",
      scene: "推荐书籍/电影/人选/活动；考研常考「推荐一本书」或「推荐候选人」",
      skeleton: [
        { part: "开头", tip: "点明推荐对象 + 一句总评" },
        { part: "主体", tip: "给出 2–3 个推荐理由（特点、优点、对你有何帮助）" },
        { part: "结尾", tip: "再次推荐 + 表达希望对方喜欢/考虑" }
      ],
      patterns: [
        {
          id: "recommendation-p1",
          en: "I take great pleasure in recommending... to you.",
          zh: "我非常乐意向您推荐……",
          note: "take pleasure in doing 乐意做某事；推荐信开头经典句。"
        },
        {
          id: "recommendation-p2",
          en: "Among the books I have read, ... impresses me most.",
          zh: "在我读过的书中，……最令我印象深刻。",
          note: "用比较级最高级突出推荐对象的独特性。"
        },
        {
          id: "recommendation-p3",
          en: "Its vivid description and profound theme make it well worth reading.",
          zh: "它生动的描写和深刻的主题使它非常值得一读。",
          note: "well worth doing 值得做；make it + adj. + to do/doing。"
        },
        {
          id: "recommendation-p4",
          en: "I am confident that he / she will prove to be a great asset to your team.",
          zh: "我相信他/她一定会成为您团队的得力人才。",
          note: "asset 有价值的人/物；推荐人选时的强力收束。"
        },
        {
          id: "recommendation-p5",
          en: "I would appreciate it if you could take my recommendation into consideration.",
          zh: "如能考虑我的推荐，将不胜感激。",
          note: "正式收尾；比 please consider my recommendation 更客气。"
        }
      ],
      sample: {
        title: "向朋友推荐一本书",
        body: "Dear Li Hua,\n\nKnowing that you are interested in Chinese literature, I take great pleasure in recommending to you the novel The Three-Body Problem.\n\nAmong the books I have read, it impresses me most. Its vivid description of the universe and profound theme make it well worth reading. Moreover, the writer’s imagination will surely broaden your mind and offer you a new way of looking at science and humanity. I believe it will also be a wonderful topic when we meet.\n\nI am sure you will love it. I would appreciate it if you could share your views with me after reading it.\n\nYours sincerely,\nLi Ming"
      }
    },
    {
      id: "inquiry",
      title: "询问信",
      en: "Letter of Inquiry",
      scene: "咨询课程、考试报名、住宿、活动细节、申请流程",
      skeleton: [
        { part: "开头", tip: "自我介绍（可选）+ 说明写信目的：咨询信息" },
        { part: "主体", tip: "按逻辑列出 2–4 个具体问题，条理清晰" },
        { part: "结尾", tip: "表达感谢 + 期待回复" }
      ],
      patterns: [
        {
          id: "inquiry-p1",
          en: "I am writing to inquire about some details concerning...",
          zh: "我写信是想咨询有关……的一些细节。",
          note: "inquire about 询问；concerning/about 均可，后接事项。"
        },
        {
          id: "inquiry-p2",
          en: "I would be grateful if you could provide me with some information about...",
          zh: "如能提供关于……的信息，我将不胜感激。",
          note: "provide sb. with sth. / provide sth. for sb. 双结构都对。"
        },
        {
          id: "inquiry-p3",
          en: "Could you please tell me whether the course is open to beginners?",
          zh: "能否告知该课程是否向初学者开放？",
          note: "whether/if 引导宾语从句；疑问务必具体。"
        },
        {
          id: "inquiry-p4",
          en: "I would also like to know if there is any scholarship available.",
          zh: "我还想了解是否提供奖学金。",
          note: "I would also like to know... 用来追加问题，层次更清楚。"
        },
        {
          id: "inquiry-p5",
          en: "I am looking forward to your early reply at your convenience.",
          zh: "期待您方便时尽早回复。",
          note: "at your convenience 在您方便时；比 as soon as possible 更客气。"
        }
      ],
      sample: {
        title: "咨询暑期英语课程",
        body: "Dear Sir or Madam,\n\nI am a sophomore and I am writing to inquire about some details concerning the summer English course advertised on your website.\n\nI would be grateful if you could provide me with some information about the course schedule and fees. Could you please tell me whether the course is open to beginners? I would also like to know if there is any scholarship available for students from rural areas. Besides, is there any chance of an online course for those who cannot stay on campus during the vacation?\n\nThank you for your time. I am looking forward to your early reply at your convenience.\n\nYours sincerely,\nLi Ming"
      }
    },
    {
      id: "application",
      title: "申请信",
      en: "Letter of Application",
      scene: "申请工作、志愿者、研究生项目、社团职位",
      skeleton: [
        { part: "开头", tip: "说明申请职位/项目 + 信息来源" },
        { part: "主体", tip: "用事实说明匹配度：教育背景、相关经历、个人品质" },
        { part: "结尾", tip: "请求考虑/面试 + 附上材料 + 致谢" }
      ],
      patterns: [
        {
          id: "application-p1",
          en: "I am writing to apply for the position of... advertised on...",
          zh: "我写信申请刊登在……上的……职位。",
          note: "advertised on your website / in the newspaper 点明信息来源。"
        },
        {
          id: "application-p2",
          en: "I believe I am well qualified for the post for the following reasons.",
          zh: "我相信自己能胜任该职位，理由如下。",
          note: "be qualified for 胜任；for the following reasons 引出分点。"
        },
        {
          id: "application-p3",
          en: "My academic background and relevant experience make me a strong candidate.",
          zh: "我的学业背景和相关经历使我成为有竞争力的候选人。",
          note: "strong candidate 有竞争力的候选人；make sb. + n.。"
        },
        {
          id: "application-p4",
          en: "During my internship at..., I was responsible for..., which sharpened my ability to...",
          zh: "在……实习期间，我负责……，这提升了我……的能力。",
          note: "经历 + 职责 + 能力提升，三段式事实论证最有说服力。"
        },
        {
          id: "application-p5",
          en: "I would be grateful if you could grant me an interview. Enclosed please find my resume.",
          zh: "如能给予面试机会，不胜感激。随信附上简历。",
          note: "grant sb. an interview 给予面试；Enclosed please find... 附件句。"
        }
      ],
      sample: {
        title: "申请学生会志愿者",
        body: "Dear Sir or Madam,\n\nI am writing to apply for the volunteer position in the Student Union, which was advertised on the campus website.\n\nI believe I am well qualified for the post. My academic background and relevant experience make me a strong candidate. Last year I served as a volunteer in the city sports meeting and was responsible for guiding foreign guests, which sharpened my communication skills. Moreover, I am outgoing, patient and accustomed to teamwork.\n\nI would be grateful if you could grant me an interview. Enclosed please find my resume for your reference.\n\nYours sincerely,\nLi Ming"
      }
    },
    {
      id: "notice",
      title: "通知",
      en: "Notice",
      scene: "讲座、比赛、会议、活动举办与报名通知（告示类小作文）",
      skeleton: [
        { part: "标题", tip: "居中写 NOTICE / 通知标题" },
        { part: "主体", tip: "活动内容 + 时间 + 地点 + 参与方式/对象（信息齐全）" },
        { part: "结尾", tip: "联系方式 / 发布单位 + 日期" }
      ],
      patterns: [
        {
          id: "notice-p1",
          en: "We are pleased to announce that... will be held...",
          zh: "我们很高兴地宣布，……将于……举行。",
          note: "be held 举行；被动语态是通知的默认语态。"
        },
        {
          id: "notice-p2",
          en: "The activity is scheduled for 2 p.m. on May 20 in the Lecture Hall.",
          zh: "活动定于 5 月 20 日下午 2 点在报告厅举行。",
          note: "be scheduled for... in... 时间地点一并交代。"
        },
        {
          id: "notice-p3",
          en: "All students are welcome to take part / sign up before Friday.",
          zh: "欢迎全体同学参加/在周五前报名。",
          note: "take part (in) 参加；sign up 报名；注意截止时间。"
        },
        {
          id: "notice-p4",
          en: "Please note that participants are required to bring their student ID cards.",
          zh: "请注意，参与者须携带学生证。",
          note: "Please note that... 提醒注意事项；be required to do 必须做。"
        },
        {
          id: "notice-p5",
          en: "For further information, please contact Li Ming at 010-12345678.",
          zh: "详情请联系李明，电话 010-12345678。",
          note: "For further information 询问详情；通知末尾固定搭配。"
        }
      ],
      sample: {
        title: "英语演讲比赛通知",
        body: "NOTICE\n\nWe are pleased to announce that the annual English Speech Contest will be held in the Lecture Hall of the Main Building. The activity is scheduled for 2 p.m. on May 20.\n\nAll students are welcome to take part, and those who are interested may sign up at the Students’ Union office before Friday. Please note that each contestant is required to speak for three minutes on the topic “Youth and Responsibility.” Excellent speakers will be awarded books and certificates.\n\nFor further information, please contact Li Ming at 010-12345678. We are looking forward to your active participation.\n\nThe Students’ Union\nMay 10"
      }
    }
  ],
  essays: [
    {
      id: "describe",
      title: "描述图画",
      en: "Describing the Picture",
      scene: "大作文第一段：客观描图 → 点明寓意（图画作文必考能力）",
      focus: "先写画面里的人/物/动作/文字，再用一句话点破象征意义，不加评论",
      skeleton: [
        { part: "第 1 句", tip: "总起：As is vividly depicted/shown in the picture..." },
        { part: "第 2–3 句", tip: "细描：人物动作、表情、场景、配文（用现在时/进行时）" },
        { part: "第 4 句", tip: "点题：The picture is intended to convey that... 揭示寓意" }
      ],
      patterns: [
        {
          id: "describe-p1",
          en: "As is vividly depicted in the picture above, ...",
          zh: "如上图生动描绘的那样，……",
          note: "描图总起句；也可以 As is shown in the chart/data... 用于图表。"
        },
        {
          id: "describe-p2",
          en: "In the cartoon, a young man is sitting in front of a computer, totally absorbed in the virtual world.",
          zh: "漫画中，一个年轻人坐在电脑前，完全沉浸在虚拟世界里。",
          note: "be absorbed in 全神贯注于；sb. is doing... 是描图主力句型。"
        },
        {
          id: "describe-p3",
          en: "Beneath the drawing, there is a caption which reads: “...”",
          zh: "图画下方有一行文字：“……”。",
          note: "caption 图画说明文字；read 写着（不用 say 更书面）。"
        },
        {
          id: "describe-p4",
          en: "The picture is simple but thought-provoking: ...",
          zh: "这幅图很简单却发人深省：……",
          note: "simple but thought-provoking 形容漫画的常用评价。"
        },
        {
          id: "describe-p5",
          en: "The drawing is intended to reveal a common phenomenon in modern society — ...",
          zh: "这幅图意在揭示现代社会的一个普遍现象——……",
          note: "be intended to do 意在；reveal a phenomenon 揭示现象。"
        }
      ],
      sample: {
        title: "图画作文范文 · 过度依赖手机",
        body: "As is vividly depicted in the picture above, a young man is sitting alone at a dinner table, staring at his smartphone while a bowl of noodles grows cold in front of him. His parents stand behind him, looking at each other with helpless smiles. Beneath the drawing, there is a caption which reads: “A family dinner without words.”\n\nThe picture is simple but thought-provoking. It is intended to reveal a common phenomenon in modern society: mobile phones are quietly alienating us from the people closest to us. When family members gather together, many of us prefer the virtual world to face-to-face conversation. Children answer their parents with brief words while their fingers never leave the screen. Although smartphones have brought great convenience to our daily lives, they should never replace genuine human warmth and care.\n\nWhat we need is not to abandon technology, but to lift our eyes from the screen when our loved ones are around. A real conversation over dinner is worth more than a hundred likes online."
      }
    },
    {
      id: "analyze",
      title: "分析原因",
      en: "Analyzing the Causes",
      scene: "大作文主体段：解释现象为何产生、说明其重要性或危害",
      focus: "给出 2–3 条层层递进的原因，用因果连接词组织，避免空喊口号",
      skeleton: [
        { part: "主题句", tip: "Several factors account for this phenomenon / Why does this happen?" },
        { part: "原因 1", tip: "个人层面：观念、习惯、压力、选择" },
        { part: "原因 2", tip: "社会/技术层面：环境、政策、科技、竞争" },
        { part: "小结", tip: "一句话收束，或递进到更深层原因" }
      ],
      patterns: [
        {
          id: "analyze-p1",
          en: "Several factors account for this phenomenon.",
          zh: "有几个因素可以解释这一现象。",
          note: "account for 解释/说明（原因）；主体段主题句首选。"
        },
        {
          id: "analyze-p2",
          en: "The main reason why... is that...",
          zh: "……的主要原因是……",
          note: "why 引导定语从句修饰 reason，表语用 that 而非 because。"
        },
        {
          id: "analyze-p3",
          en: "This is largely due to the fact that people are under growing pressure to...",
          zh: "这在很大程度上是因为人们面临着越来越大的……压力。",
          note: "largely due to the fact that... 书面化归因句。"
        },
        {
          id: "analyze-p4",
          en: "Another contributing factor is the rapid development of...",
          zh: "另一个起作用的因素是……的快速发展。",
          note: "contributing factor 起作用的因素；用来递进第二个原因。"
        },
        {
          id: "analyze-p5",
          en: "As a result, a growing number of people tend to..., which in turn...",
          zh: "结果，越来越多的人倾向于……，而这反过来又……",
          note: "as a result 结果；in turn 反过来，表示连锁反应。"
        },
        {
          id: "analyze-p6",
          en: "What really matters is not... but...",
          zh: "真正重要的不是……而是……",
          note: "用于分析段收束或拨正误解，强调真正原因。"
        }
      ],
      sample: {
        title: "大作文范文 · 大学生阅读量下降",
        body: "The decline in college students’ reading has become a topic of concern. Several factors account for this phenomenon.\n\nTo begin with, the main reason why young people read fewer books is that their time and attention are fragmented by short videos and social media. A ten-minute video seems more rewarding than a thick novel, so many students never start. Another contributing factor is the pressure of exams and job hunting. Under the burden of endless assignments and internships, reading for pleasure is often treated as a luxury rather than a daily habit. Finally, some universities offer few inspiring reading programs or guided discussions, which makes it harder for students to form a lasting interest in books.\n\nAs a result, a growing number of students graduate with professional skills but a thin inner world. When they face setbacks, they may find few ideas to turn to. What really matters is not how many books one buys, but whether one still keeps the habit of reading and thinking."
      }
    },
    {
      id: "suggest",
      title: "给出建议",
      en: "Offering Solutions",
      scene: "大作文对策段：针对问题提出具体、可行的建议与措施",
      focus: "建议主体要明确（个人/学校/社会/政府），动词要具体，忌空话",
      skeleton: [
        { part: "主题句", tip: "Effective measures should be taken / It is high time that we..." },
        { part: "建议 1", tip: "个人：改变观念、培养习惯、从小事做起" },
        { part: "建议 2", tip: "学校/社会/政府：制度、引导、环境支持" },
        { part: "收束", tip: "Only in this way can we... 倒装升华" }
      ],
      patterns: [
        {
          id: "suggest-p1",
          en: "It is high time that we took concrete steps to tackle this problem.",
          zh: "是时候采取具体措施来解决这一问题了。",
          note: "It is high time that + 过去式（虚拟语气），语气强、常用于对策段开头。"
        },
        {
          id: "suggest-p2",
          en: "Effective measures should be taken by individuals and society alike.",
          zh: "个人与社会都应采取有效措施。",
          note: "alike 放句末表示“同样地”，一笔带出两个主体。"
        },
        {
          id: "suggest-p3",
          en: "For one thing, we should develop the habit of... rather than...",
          zh: "一方面，我们应养成……的习惯，而不是……",
          note: "For one thing... For another... 配对使用，层次清晰。"
        },
        {
          id: "suggest-p4",
          en: "Schools and universities are expected to offer more guidance and activities related to...",
          zh: "学校应提供更多与……相关的指导和活动。",
          note: "be expected to do 有望/应该做；语气比 should 稍缓。"
        },
        {
          id: "suggest-p5",
          en: "Last but not least, the media can play a constructive role in advocating...",
          zh: "最后同样重要的是，媒体可在倡导……方面发挥建设性作用。",
          note: "play a constructive/positive role in doing 发挥建设性作用。"
        },
        {
          id: "suggest-p6",
          en: "Only in this way can we build a better and more harmonious society.",
          zh: "只有这样，我们才能建设更美好、更和谐的社会。",
          note: "Only + 状语置首引起部分倒装；收尾万能升华句（慎用堆砌）。"
        }
      ],
      sample: {
        title: "大作文范文 · 培养青少年诚信",
        body: "Honesty is a basic virtue, yet cheating in exams and even in daily life is not rare among teenagers. It is high time that we took concrete steps to guide them in the right direction.\n\nFor one thing, parents and teachers should set good examples and praise honest behavior rather than only high scores. A child who is never punished for a small lie may grow into an adult who twists the truth without guilt. For another, schools are expected to offer more activities related to moral education, such as discussions of real-life dilemmas and stories of role models, so that students can see why honesty matters in the long run. Last but not least, the media can play a constructive role in advocating integrity and in telling the stories of ordinary people who keep their word under pressure.\n\nOnly in this way can we help young people understand that honesty is not a burden, but the foundation of trust and lasting success."
      }
    },
    {
      id: "conclude",
      title: "总结升华",
      en: "Concluding & Elevating",
      scene: "大作文末段：总结全文、点明态度、适度升华主题",
      focus: "用不同措辞重申观点，避免重复首段原句；升华落到个人行动或长远价值",
      skeleton: [
        { part: "总结句", tip: "In conclusion / Taking all factors into account..." },
        { part: "重申观点", tip: "换一种说法复述中心论点" },
        { part: "升华", tip: "点出对个人/社会/未来的意义，或呼吁行动" }
      ],
      patterns: [
        {
          id: "conclude-p1",
          en: "Taking all these factors into consideration, we can safely conclude that...",
          zh: "综合考虑这些因素，我们可以有把握地得出结论：……",
          note: "safely conclude 有把握地得出；比 I think 更有力度。"
        },
        {
          id: "conclude-p2",
          en: "In the final analysis, ... is not a temporary trend but a lasting value.",
          zh: "归根结底，……不是一时的潮流，而是持久的价值。",
          note: "in the final analysis 归根结底；适合价值升华。"
        },
        {
          id: "conclude-p3",
          en: "Only when we... can we truly embrace a brighter future.",
          zh: "只有当我们……时，才能真正拥抱更光明的未来。",
          note: "Only when... 引起倒装；比 Only in this way 更具体。"
        },
        {
          id: "conclude-p4",
          en: "In short, the picture serves as a reminder that we should never ignore...",
          zh: "简言之，这幅图提醒我们绝不应忽视……",
          note: "serve as a reminder that... 起到提醒作用；回扣图画。"
        },
        {
          id: "conclude-p5",
          en: "As college students, we are supposed to take the lead in... and turn the idea into action.",
          zh: "作为大学生，我们应当在……方面身体力行，把理念落到行动上。",
          note: "take the lead in doing 带头做；落到行动，避免空升华。"
        }
      ],
      sample: {
        title: "大作文范文 · 终身学习",
        body: "As is shown in the picture, an old man is learning how to use a tablet computer while his grandson looks on with admiration. The caption says: “Learning has no age limit.”\n\nThis simple scene reflects a truth that is easy to understand yet hard to practice. In a world of rapid change, knowledge goes out of date faster than ever, and those who stop learning soon fall behind their peers and even behind the times. Taking all these factors into consideration, we can safely conclude that lifelong learning is not a choice but a necessity for anyone who wants to keep pace with modern society. It helps us solve new problems at work and keeps our minds active and open in daily life.\n\nIn the final analysis, learning is not only a tool for better jobs, but a way to keep our minds young. As college students, we are supposed to take the lead in reading widely, questioning deeply and turning what we learn into action."
      }
    }
  ],
  sentences: [
    // ── 开头 opening ──
    { id: "s1", cat: "开头", en: "When it comes to this issue, opinions vary from person to person.", zh: "谈到这个问题，人们的看法各不相同。", scene: "议论类作文开头，引出话题有争议" },
    { id: "s2", cat: "开头", en: "In recent years, the problem of... has attracted widespread attention.", zh: "近年来，……问题引起了广泛关注。", scene: "社会现象类作文开头" },
    { id: "s3", cat: "开头", en: "The past few years have witnessed a growing concern over...", zh: "过去几年里，人们对……的关注与日俱增。", scene: "用时间作主语，比 People are concerned 更地道" },
    { id: "s4", cat: "开头", en: "As is vividly depicted in the cartoon, ...", zh: "如漫画生动描绘的那样，……", scene: "图画作文描图总起句" },
    { id: "s5", cat: "开头", en: "It is universally acknowledged that knowledge is power.", zh: "人们普遍认为知识就是力量。", scene: "引用共识开启论证；也可替换 that 从句内容" },
    { id: "s6", cat: "开头", en: "There is a growing awareness that quality matters more than quantity.", zh: "人们越来越意识到质量比数量更重要。", scene: "引出新观念、新认识" },
    { id: "s7", cat: "开头", en: "Few topics have aroused as much debate as how to balance work and life.", zh: "很少有话题像“如何平衡工作与生活”那样引发如此多争论。", scene: "强调话题热度，适合争议类" },
    { id: "s8", cat: "开头", en: "The picture is simple but thought-provoking.", zh: "这幅图画很简单却发人深省。", scene: "图画作文第二段起笔或首段评价句" },

    // ── 过渡 transition ──
    { id: "s9", cat: "过渡", en: "Nevertheless, it is worth noting that convenience often comes at a price.", zh: "然而值得注意的是，便利往往是有代价的。", scene: "转折并引出新论点；worth noting that 后接完整句" },
    { id: "s10", cat: "过渡", en: "This is not to say that technology is useless; rather, it should be used wisely.", zh: "这并不是说科技无用，而是说应当明智地使用它。", scene: "自我限定，防止观点绝对化" },
    { id: "s11", cat: "过渡", en: "More importantly, the change reflects a shift in people’s values.", zh: "更重要的是，这一变化反映了人们价值观的转变。", scene: "递进到更深层论点" },
    { id: "s12", cat: "过渡", en: "Equally important is the fact that habits are formed in childhood.", zh: "同样重要的是，习惯是在童年形成的。", scene: "表语前置倒装，书面感强" },
    { id: "s13", cat: "过渡", en: "In addition to economic growth, cultural confidence deserves attention.", zh: "除了经济增长，文化自信也值得关注。", scene: "引出并列的第二个维度" },
    { id: "s14", cat: "过渡", en: "On a deeper level, the issue concerns the way we define success.", zh: "从更深层次看，这个问题关系到我们如何定义成功。", scene: "把讨论推向价值观层面" },
    { id: "s15", cat: "过渡", en: "From my perspective, the benefits of this trend outweigh its drawbacks.", zh: "在我看来，这一趋势利大于弊。", scene: "亮明个人观点的过渡句" },

    // ── 举例 example ──
    { id: "s16", cat: "举例", en: "A case in point is the popularity of shared bicycles in Chinese cities.", zh: "一个典型的例子是中国城市里共享单车的流行。", scene: "引出具体例子，后可再展开一两句" },
    { id: "s17", cat: "举例", en: "This is best illustrated by the example of..., who... despite...", zh: "……的例子最能说明这一点：他/她尽管……仍然……", scene: "用人物事例论证品质/坚持等主题" },
    { id: "s18", cat: "举例", en: "Take online education as an example.", zh: "以在线教育为例。", scene: "简短举例，适合篇幅紧张时" },
    { id: "s19", cat: "举例", en: "History offers us many examples of perseverance leading to success.", zh: "历史为我们提供了许多坚持带来成功的例子。", scene: "从历史/经验取证，显得论据扎实" },
    { id: "s20", cat: "举例", en: "Such cases as students staying up with short videos are not uncommon.", zh: "学生刷短视频熬夜这类情况并不罕见。", scene: "such cases as + 名词短语，列举身边现象" },
    { id: "s21", cat: "举例", en: "To illustrate this point, we may look at what happens in our daily life.", zh: "为了说明这一点，我们可以看看日常生活中会发生什么。", scene: "用生活常识补证，衔接自然" },

    // ── 对比 contrast ──
    { id: "s22", cat: "对比", en: "Some people argue that wealth means success, while others believe that health counts more.", zh: "有人认为财富意味着成功，也有人认为健康更重要。", scene: "呈现两种对立观点，随后表态" },
    { id: "s23", cat: "对比", en: "Unlike book knowledge, practical skills can be applied directly in work.", zh: "与书本知识不同，实用技能可直接应用于工作。", scene: "unlike + 名词，简洁对比两事物" },
    { id: "s24", cat: "对比", en: "By contrast, those who keep learning tend to adapt more easily to change.", zh: "相比之下，坚持学习的人往往更容易适应变化。", scene: "段落之间或句子之间的对照" },
    { id: "s25", cat: "对比", en: "On the one hand, the Internet enriches our lives; on the other hand, it may isolate us.", zh: "一方面，互联网丰富了我们的生活；另一方面，它也可能使我们孤立。", scene: "同一事物的利弊两面" },
    { id: "s26", cat: "对比", en: "Rather than chasing quick rewards, we should focus on long-term growth.", zh: "我们应关注长期成长，而非追逐短期回报。", scene: "rather than doing 放句首，对比鲜明" },
    { id: "s27", cat: "对比", en: "What makes the difference is not intelligence but persistence.", zh: "造成差异的不是智力，而是坚持。", scene: "强调真正关键的对比项" },

    // ── 让步 concession ──
    { id: "s28", cat: "让步", en: "Admittedly, pressure can push us forward; however, too much of it does harm.", zh: "诚然，压力能推动我们前进；然而过多则有害。", scene: "先让步再转折，论证更客观" },
    { id: "s29", cat: "让步", en: "Despite the fact that the task is difficult, we should not give up halfway.", zh: "尽管任务艰巨，我们也不应半途而废。", scene: "despite + 名词性结构，不接句子" },
    { id: "s30", cat: "让步", en: "While it is true that money is important, it is far from everything.", zh: "金钱固然重要，但绝不是一切。", scene: "While 引导让步，书面常用" },
    { id: "s31", cat: "让步", en: "Even if we fail several times, it does not follow that we are losers.", zh: "即使失败几次，也不能因此就说我们是失败者。", scene: "it does not follow that 不能因此得出" },
    { id: "s32", cat: "让步", en: "Granted, technology has its risks; nevertheless, its advantages cannot be ignored.", zh: "不错，科技有其风险；但其优势同样不可忽视。", scene: "Granted... nevertheless... 高阶让步" },
    { id: "s33", cat: "让步", en: "Notwithstanding the challenges involved, the plan is worth trying.", zh: "尽管存在种种挑战，该计划仍值得一试。", scene: "notwithstanding = despite，提升词汇多样性" },

    // ── 因果 cause ──
    { id: "s34", cat: "因果", en: "A number of factors account for this phenomenon.", zh: "有若干因素可以解释这一现象。", scene: "原因分析段的主题句" },
    { id: "s35", cat: "因果", en: "The main reason why many young people lack patience is that they are used to instant feedback.", zh: "许多年轻人缺乏耐心，主要原因是他们习惯了即时反馈。", scene: "The reason why... is that... 正式归因" },
    { id: "s36", cat: "因果", en: "This is largely due to the rapid development of the Internet.", zh: "这在很大程度上是由于互联网的快速发展。", scene: "be due to + 名词，书面归因" },
    { id: "s37", cat: "因果", en: "As a consequence, a widening gap appears between theory and practice.", zh: "结果，理论与实践之间出现了越来越大的差距。", scene: "引出结果；consequence 比 result 更书面" },
    { id: "s38", cat: "因果", en: "Reading widely contributes greatly to the formation of independent thinking.", zh: "广泛阅读非常有助于独立思考的形成。", scene: "contribute to + 名词，表促进作用" },
    { id: "s39", cat: "因果", en: "The consequences of ignoring mental health may be far-reaching.", zh: "忽视心理健康的后果可能十分深远。", scene: "引出危害，强调严重性" },

    // ── 强调 emphasis ──
    { id: "s40", cat: "强调", en: "It is persistence that really matters in the long run.", zh: "从长远看，真正重要的是坚持。", scene: "It is... that 强调句，突出核心词" },
    { id: "s41", cat: "强调", en: "Nothing is more important than keeping a curious mind.", zh: "没有什么比保持好奇心更重要。", scene: "最高级否定式强调，语气强烈" },
    { id: "s42", cat: "强调", en: "There is no denying that cooperation has become a must in modern society.", zh: "不可否认，合作已成为现代社会的必需。", scene: "引出无可争议的前提" },
    { id: "s43", cat: "强调", en: "What impresses me most is his courage to admit mistakes.", zh: "最打动我的是他承认错误的勇气。", scene: "突出印象最深的一点，适合品质类" },
    { id: "s44", cat: "强调", en: "Under no circumstances should we sacrifice honesty for short-term gains.", zh: "任何情况下我们都不应为短期利益牺牲诚实。", scene: "否定词置首部分倒装，强调底线" },

    // ── 结论 conclusion ──
    { id: "s45", cat: "结论", en: "In conclusion, the key to success lies in continuous effort.", zh: "总之，成功的关键在于持续努力。", scene: "结尾段标准总结句" },
    { id: "s46", cat: "结论", en: "Taking all factors into account, we can safely reach the conclusion that...", zh: "把所有因素考虑在内，我们可以有把握地得出结论：……", scene: "稍长但有分量的收束句" },
    { id: "s47", cat: "结论", en: "Only in this way can we make a real difference in our study and life.", zh: "只有这样，我们才能在学习和生活中带来真正的改变。", scene: "倒装收尾；difference 前加 real/simple 等修饰" },
    { id: "s48", cat: "结论", en: "It is high time that we attached greater importance to mental health.", zh: "我们早就应该更加重视心理健康了。", scene: "呼吁行动；that 从句用虚拟语气（过去式）" },
    { id: "s49", cat: "结论", en: "In short, the cartoon serves as a reminder that we should value what we already have.", zh: "简言之，这幅漫画提醒我们要珍惜已经拥有的一切。", scene: "回扣图画，收束全文" },
    { id: "s50", cat: "结论", en: "As college students, we ought to turn the right idea into daily practice.", zh: "作为大学生，我们应当把正确的理念落实到日常行动中。", scene: "落到自身行动，避免假大空" }
  ]
};
