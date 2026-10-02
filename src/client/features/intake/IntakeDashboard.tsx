import {
  Activity,
  ArrowRight,
  ChevronRight,
  Heart,
  Leaf,
  LockKeyhole,
  MessageCircle,
  Plus,
} from "lucide-react";
import type { Instrument } from "../../api/types.js";

type IntakeDashboardProps = {
  disabled: boolean;
  onNewIntake: () => void;
  onAssessment: (instrument: Instrument) => void;
};

export function IntakeDashboard({ disabled, onNewIntake, onAssessment }: IntakeDashboardProps) {
  const today = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  return (
    <>
      <div className="xq-welcome-line">
        <span>
          <span className="xq-sun">✳</span> 咨询师，欢迎回来
        </span>
        <time>{today}</time>
      </div>
      <section className="xq-hero">
        <div className="xq-hero-copy">
          <span className="xq-eyebrow">
            <span /> 一个有温度的咨询工作空间
          </span>
          <h1>
            让每一次倾听，
            <br />
            更有<span>方向。</span>
          </h1>
          <p>
            把信息整理交给心桥，
            <br className="xq-small-break" />
            把专注与理解留给来访者。
          </p>
          <button className="xq-button xq-button-primary" onClick={onNewIntake} disabled={disabled}>
            <Plus size={18} /> 开始新的接诊 <ArrowRight size={17} />
          </button>
          <small>
            <LockKeyhole size={12} /> 为心理咨询师提供辅助，专业判断始终由你掌握
          </small>
        </div>
        <div className="xq-hero-art" aria-hidden="true">
          <div className="xq-orbit xq-orbit-one" />
          <div className="xq-orbit xq-orbit-two" />
          <div className="xq-art-leaf xq-leaf-one" />
          <div className="xq-art-leaf xq-leaf-two" />
          <div className="xq-art-leaf xq-leaf-three" />
          <div className="xq-art-stem" />
          <div className="xq-art-disc">
            <MessageCircle size={51} strokeWidth={1} />
            <Heart size={21} strokeWidth={1.4} />
          </div>
          <span className="xq-art-caption">LISTEN. UNDERSTAND. SUPPORT.</span>
        </div>
      </section>
      <section className="xq-start-section">
        <div className="xq-section-heading">
          <div>
            <h2>从理解来访者开始</h2>
            <p>有序梳理信息，让接诊过程更从容</p>
          </div>
          <span>你的接诊路径</span>
        </div>
        <div className="xq-process">
          <div>
            <span>01</span>
            <div>
              <h3>建立接诊</h3>
              <p>记录议题，确认知情同意</p>
            </div>
          </div>
          <ChevronRight size={16} />
          <div>
            <span>02</span>
            <div>
              <h3>梳理叙述</h3>
              <p>辅助追问，关注风险信号</p>
            </div>
          </div>
          <ChevronRight size={16} />
          <div>
            <span>03</span>
            <div>
              <h3>整理与复核</h3>
              <p>参考筛查，生成接诊摘要</p>
            </div>
          </div>
        </div>
      </section>
      <section className="xq-tools-section">
        <div className="xq-section-heading">
          <div>
            <h2>接诊辅助工具</h2>
            <p>在合适的时机，为专业评估补充线索</p>
          </div>
          <span className="xq-subtle-badge">需咨询师复核</span>
        </div>
        <div className="xq-tool-cards">
          <button className="xq-tool-card" onClick={() => onAssessment("phq9")}>
            <span className="xq-tool-icon sage">
              <Activity size={24} strokeWidth={1.5} />
            </span>
            <span className="xq-tool-tag">PHQ-9</span>
            <h3>抑郁症状筛查</h3>
            <p>了解过去两周的情绪、兴趣与生活状态</p>
            <span className="xq-tool-bottom">
              9 个问题 · 约 3 分钟
              <ArrowRight size={17} className="xq-arrow-diagonal" />
            </span>
          </button>
          <button className="xq-tool-card" onClick={() => onAssessment("gad7")}>
            <span className="xq-tool-icon sand">
              <Leaf size={24} strokeWidth={1.5} />
            </span>
            <span className="xq-tool-tag">GAD-7</span>
            <h3>焦虑症状筛查</h3>
            <p>识别近期的紧张、担忧及其影响</p>
            <span className="xq-tool-bottom">
              7 个问题 · 约 2 分钟
              <ArrowRight size={17} className="xq-arrow-diagonal" />
            </span>
          </button>
        </div>
      </section>
      <div className="xq-bottom-message">
        <Heart size={14} />
        <span>技术辅助整理，人与人之间的理解始终在场。</span>
      </div>
    </>
  );
}
