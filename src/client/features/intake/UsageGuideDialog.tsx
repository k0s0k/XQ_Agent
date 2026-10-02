import { ArrowRight, ShieldCheck } from "lucide-react";
import { Modal } from "../../components/Modal.js";

export function UsageGuideDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="让辅助更有边界，让接诊更有温度"
      subtitle="心桥服务于心理咨询师的接诊工作。"
      onClose={onClose}
    >
      <div className="xq-guide">
        <div>
          <span>01</span>
          <section>
            <h3>先取得知情同意</h3>
            <p>
              向来访者说明 AI
              辅助的目的和局限。使用代称，避免录入身份证、联系方式等不必要的个人信息。在线模式会将接诊内容发至你配置的模型服务，请先确认其数据处理规则。
            </p>
          </section>
        </div>
        <div>
          <span>02</span>
          <section>
            <h3>由咨询师主导判断</h3>
            <p>
              AI 提供追问建议、信息整理和风险线索，不作确定诊断、不替代专业评估、不提供处方。PHQ-9
              与 GAD-7 是症状筛查，结果需要结合访谈、功能影响和其他信息解读。
            </p>
          </section>
        </div>
        <div>
          <span>03</span>
          <section>
            <h3>及时核实安全，妥善保存记录</h3>
            <p>
              危机提示可能遗漏或误报，不能替代直接安全评估。接诊记录与密钥存于服务内存，重启服务后清空；知识库资料单独保存在本机，重启后保留。需要保留时请主动导出摘要并按机构制度存放。
            </p>
          </section>
        </div>
        <div>
          <span>04</span>
          <section>
            <h3>直接对话，查看每轮知识依据</h3>
            <p>
              主对话无需建立来访者档案，配置模型并授权后即可直接提问。可设置 Top
              K（1–10）匹配不同文档，查看每条回复对应的来源。知识库支持文件导入与本地检索，检索分数仅反映文本匹配。资料默认不向模型发送；文档授权、个案外部处理同意和本次接诊检索开关均开启后，匹配片段才会用于在线回答。来源与引用仍须人工复核。
            </p>
          </section>
        </div>
        <div className="xq-inline-info">
          <ShieldCheck size={18} />
          <p>
            当前原型面向成人接诊，量表限成人症状筛查。未成年人需采用适龄流程与工具，本工作台暂不支持。
          </p>
        </div>
      </div>
      <button className="xq-button xq-button-primary xq-full-button" onClick={onClose}>
        了解，继续工作
        <ArrowRight size={16} />
      </button>
    </Modal>
  );
}
