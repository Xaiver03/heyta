# 隐私增强的云端 LLM 推理调研（2026-09）

面向场景：本地优先、端到端加密的任务管理应用，服务端从设计上不得看到用户明文。

---

## 1. 机密计算 / TEE 用于 LLM 推理（2026 年现状）

### 1.1 硬件基础

NVIDIA 自 H100 起首次在 GPU 上引入 TEE：GPU 内部计算本身不受影响，开销主要来自 CPU↔GPU 的 PCIe 传输，数据经 "bounce buffer" 加解密，且必须与 CPU TEE（Intel TDX 或 AMD SEV-SNP）配合，通过 SPDM 建立 CPU–GPU 安全会话，使 PCIe 上的数据保持加密 `[来源: https://arxiv.org/html/2409.03992v2]`。AMD SEV-SNP 用 AES-128 加密整个 VM 内存，Intel TDX 用 VMX 扩展做 VM 级隔离 `[来源: https://www.sciencedirect.com/science/article/pii/S0167404825001464]`。Arm CCA 是 Armv9-A 的架构特性，提供名为 Realm 的隔离环境，保证机密性与完整性但不保证可用性 `[来源: https://support.arm.com/documentation/den0125/400/Arm-CCA-Extensions]`；其 2026 年的生产级 GPU 配套情况 `[未找到公开信息]`。

### 1.2 已发表的开销数字

- **H100（vLLM 0.5.4 基准）**：绝大多数典型 LLM 查询开销低于 5%，平均低于 7%；模型越大、序列越长开销越趋近于零。Llama-3.1-8B 的 TPS 开销 6.85%、Phi-3-14B-128k 为 4.58%、Llama-3.1-70B 为 −0.13%（负值源于精度损失）；TTFT 开销分别为 19.03%、18.02%、−0.41% `[来源: https://arxiv.org/html/2409.03992v2]`。
- **Blackwell B200（NVIDIA 官方，2026-09）**：8×B200、DeepSeek-R1-0528-NVFP4、32K 输入/1K 输出、TP=8，开启 CC 后保留 CC-off 吞吐的 96.1%–98.2%，每 token 延迟（TPOT）仅增加 1.2%–4.3%（并发 1–16）`[来源: https://developer.nvidia.com/blog/enabling-private-high-performance-production-ai-inference-with-nvidia-confidential-computing/]`。
- **Blackwell CC 的工程代价（非纯性能）**：host-to-device 必须走软件加密 bounce buffer，pinned memory 失去异步优势，需改用 pageable memory；kernel autotuner 的 CUDA event 计时不稳定，需改用 GPU `%globaltimer`；NVLS multicast 在 B200 CC 下不可用，多卡通信算法必须重选 `[来源: https://developer.nvidia.com/blog/enabling-private-high-performance-production-ai-inference-with-nvidia-confidential-computing/]`。
- **CPU 侧（二手来源，仅作参考）**：AMD SEV-SNP 在 CPU 密集负载约 2–5%、内存密集 5–10%，内存延迟在某些访问模式下最高可达 5 倍 `[来源: https://www.servnetuk.com/learn/confidential-computing-explained]`。

### 1.3 能否真正做到"运营方看不到明文"

TEE 的威胁模型是"防御拥有整个基础设施特权（可 dump VM 内存、绕过内部接口）的恶意云厂商与服务管理员"，但**不覆盖**提示注入、越狱、数据投毒 `[来源: https://arxiv.org/html/2606.11145v1]`。因此答案是有条件的"能"：对**软件层**运营方成立，对**硬件层**运营方不成立。

OpenPcc 论文对现有方案的七项属性评分指出：Apple PCC 与 Google PAC 的推理服务运营方同时就是硬件信任根运营方，一旦该运营方出现硬件漏洞或内鬼，没有可外部验证的缓解手段 `[来源: https://arxiv.org/html/2606.11145v1]`。此外，若构建不可复现（无法从源码重建并逐位比对度量值），"非留存"就只是策略声明而非可验证保证 `[来源: https://arxiv.org/html/2606.11145v1]`。

### 1.4 已知攻击

- **DDRop（CCS 2026）**：约 159–200 美元的 DDR5 内存互连器（interposer）+ 服务器控制，可对 Intel TDX、Intel Scalable SGX、AMD SEV-SNP **重放旧的加密内存数据**，打破机密计算的内存保护保证 `[来源: https://thehackernews.com/2026/09/new-ddrop-attack-breaks-intel-tdx-and.html]` `[来源: https://www.scworld.com/brief/ddrop-attack-bypasses-intel-and-amd-confidential-computing-defenses]`。
- **历史与持续存在的侧信道**：SGX 有 Foreshadow（CVE-2018-3615）、SGAxe、ÆPIC Leak；SEV 有 SEVered；SEV-SNP 有 CVE-2025-0033（RMPocalypse）；TDX 曝光窗口较短但已有 KU Leuven 等机构的侧信道研究，Intel 通过 TDX module 更新修补 `[来源: https://eco.com/support/en/articles/14796363-intel-sgx-vs-amd-sev-vs-arm-trustzone]`。
- **应用层泄漏**：已有针对 Apple Intelligence 的 token 窃取攻击，以及通过共享 KV cache 泄漏 prompt 的研究——说明生产级机密推理服务暴露的"默认可信面"是真实攻击面 `[来源: https://arxiv.org/html/2606.11145v1]`。

### 1.5 提供机密 GPU 推理的厂商

| 提供方 | 形态 | 依据 |
|---|---|---|
| Azure | `NCCadsH100v5` 系列：AMD SEV-SNP CVM + NVIDIA H100 NVL，2024-09 GA（East US2 / West Europe） | `[来源: https://learn.microsoft.com/en-us/azure/confidential-computing/gpu-options]` `[来源: https://blogs.nvidia.com/blog/azure-confidential-vm-h100-general-availability/]` |
| Google Cloud | Confidential VM 支持 H100 GPU；Confidential Space 用于多方共享敏感数据工作负载 | `[来源: https://cloud.google.com/security/products/confidential-computing]` `[来源: https://docs.cloud.google.com/confidential-computing/confidential-vm/docs/confidential-vm-overview]` |
| Google Private AI Compute | 基于 AMD SEV-SNP + TPU，2025-11 发布 | `[来源: https://blog.google/innovation-and-ai/products/google-private-ai-compute/]` |
| AWS Nitro Enclaves | 有 LLM 推理示例，但**不支持 GPU** | `[来源: https://github.com/aws/aws-nitro-enclaves-cli/issues/517]` `[来源: https://aws.amazon.com/blogs/machine-learning/large-language-model-inference-over-confidential-data-using-aws-nitro-enclaves/]` |
| Phala Cloud | Intel TDX + NVIDIA H100/H200，可部署 vLLM | `[来源: https://github.com/Phala-Network/phala-cloud]` |
| Tinfoil | NVIDIA CC GPU + enclave，安全关键代码开源 + 透明日志 + 客户端侧验签 | `[来源: https://tinfoil.sh/technology]` `[来源: https://docs.tinfoil.sh/verification/attestation-architecture]` |
| Privatemode（Edgeless Systems） | AMD EPYC + H100，开源 + 可复现构建 + 透明日志 | `[来源: https://www.privatemode.ai/]` `[来源: https://www.edgeless.systems/press-release-edgeless-systems-to-launch-privatemode-ai]` |
| Together AI / Anyscale | 机密 GPU 推理产品 | `[未找到公开信息]` |

### 1.6 相关栈的许可证

- **vLLM**：Apache-2.0 `[来源: https://github.com/vllm-project/vllm/blob/main/LICENSE]`
- **NVIDIA nvTrust / Attestation SDK**：Apache-2.0 `[来源: https://github.com/NVIDIA/nvtrust/]`
- **Open Enclave SDK**：MIT `[来源: https://openenclave.github.io/openenclave/api/index.html]`
- **Confidential Containers Trustee**：Apache-2.0（Fedora 打包元数据列出 Apache-2.0 及若干 BSD/ISC 混合许可）`[来源: https://packages.fedoraproject.org/pkgs/trustee/trustee-kbs]`
- **Apple swift-homomorphic-encryption**：Apache-2.0 `[来源: https://github.com/apple/swift-homomorphic-encryption/blob/main/LICENSE.txt]`
- ⚠️ **Zama Concrete ML**：仓库自述为 "Clear license only for development…"，**生产/商用需另行授权**，不是无限制的 Apache-2.0 `[来源: https://github.com/zama-ai/concrete-ml]`。对以"MIT/Apache/BSD 白名单"为准入门的项目，这是一个明确的红灯。

---

## 2. Apple Private Cloud Compute（PCC）

官方技术细节见《Private Cloud Compute Security Guide》：`https://security.apple.com/documentation/private-cloud-compute` `[来源: https://security.apple.com/documentation/private-cloud-compute]`；配套源码在 `github.com/apple/security-pcc` `[来源: https://github.com/apple/security-pcc]`。

**五条核心要求**：用户数据上的无状态计算、可强制执行的保证、无特权运行时访问、不可定向性（non-targetability）、可验证透明性 `[来源: https://security.apple.com/blog/private-cloud-compute/]`。

**具体机制**：

1. **端到端加密到节点**：设备把请求直接加密给"已被验证且持有证书"的 PCC 节点公钥；负载均衡器、privacy gateway 等都在信任边界外，没有解密密钥 `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
2. **无状态的可强制执行**：Secure Enclave 在**每次重启时随机化数据卷加密密钥且不持久化**，从而在密码学上保证每次 SEP 重启即擦除数据卷；推理进程在请求完成时删除相关数据，处理用户数据的地址空间周期性回收 `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
3. **无特权运行时访问**：节点**不含远程 shell、不含交互式调试机制、不能开启 Developer Mode**；不含通用日志系统，只有预先定义、经审计的结构化日志与指标可以出节点 `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
4. **不可定向性 / target diffusion**：请求元数据不含个人身份信息；带一次性凭证（RSA Blind Signatures, RFC 9474）授权合法请求而不绑定用户；请求经**第三方运营的 OHTTP relay（RFC 9458）**隐藏源 IP；设备只把请求加密给 PCC 节点的一个**子集**，因此单点沦陷只能解密一小部分流量 `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
5. **可验证透明性**：所有生产构建的软件镜像公开供安全研究；度量值写入**只追加、密码学防篡改的透明日志**；设备只向"能密码学证明自己运行的是公开列表中软件"的节点发送数据；镜像在进入日志后 **90 天内**或相关更新可用后（取更早者）发布；PCC 镜像首次以**明文**包含 sepOS 固件与 iBoot 引导程序 `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
6. **供应链与物理攻击**：制造阶段对每个服务器组件做高分辨率成像并激活防拆开关，到达数据中心后由多个 Apple 团队交叉核验，并有**非 Apple 的第三方观察员**监督，最终为每个节点签发以 Secure Enclave UID 为根的证书 `[来源: https://security.apple.com/blog/private-cloud-compute/]`。

**独立性批评（重要）**：OpenPcc 论文指出 PCC 的信任根（Apple 自研芯片 + Apple 的 Data Center Attestation CA）与服务运营方是同一方，因此 PCC 在"信任分离"（P6）上评分为 ○；PCC 虽公开镜像可供检查，但构建流水线与相当一部分周边代码未公开，第三方能确认"在跑什么"，**不能独立复现构建** `[来源: https://arxiv.org/html/2606.11145v1]`。

**对第三方开发者开放**：App Store Small Business Program 且首次下载量少于 200 万的开发者，可免费使用 PCC 上的 Apple Foundation Models（需申请 PCC entitlement）`[来源: https://developer.apple.com/private-cloud-compute/]`。

---

## 3. 零知识 / 同态加密 / 安全多方计算用于 LLM 推理

**结论：2026 年对小型应用仍不可生产化。**

- **FHE**：THOR 在 HE 下做 GPU 推理，**仅约 0.2 tokens/s** `[来源: https://arxiv.org/html/2606.11145v1]`。一篇 2026 年的工作把 Concrete ML 的 HE 算子注入 Llama-3 推理流水线，声称在 i9 CPU 上达到最高 98% 文本生成准确率、237 ms 延迟、最高 80 tokens/s——但**只加密了部分层**，不是端到端全模型加密 `[来源: https://arxiv.org/abs/2604.12168]`。Zama 官方也提供 Concrete ML 的 LLM 编译指南 `[来源: https://docs.zama.org/concrete-ml/llms/inference]`，但其许可证不允许无授权商用（见 §1.6）。
- **MPC**：MPCFormer 用 MPC + 知识蒸馏，在 IMDb 上达到 BERT_BASE 同等效果且快 5.3×，在 GLUE 上达到 BERT_BASE 的 97% 效果且快 2.2× `[来源: https://arxiv.org/abs/2211.01452]`。BOLT 相比当时 SOTA 快 4.8–9.5× `[来源: https://www.computer.org/csdl/proceedings-article/sp/2024/313000a130/1Ub23O2X00U]`。注意这些"倍数"是相对**更慢的 MPC 基线**，绝对值仍是数秒到数十秒级；且这些工作针对 BERT 级编码器模型，不是自回归生成。
- **ZK 用于 LLM 推理**：`[未找到公开信息]`（未检索到 2026 年可用的、面向生成式 LLM 推理的 ZK 方案）。
- **Nillion**：主打基于 MPC/FHE 的 "Blind Computer"，定位是隐私计算网络而非 LLM 推理服务 `[来源: https://docs.nillion.com/blind-computer/learn/overview]`。
- **IronCore Labs Cloaked AI**：面向**向量嵌入**的加解密与向量数据库保护，不是 LLM 推理本身 `[来源: https://ironcorelabs.com/docs/cloaked-ai/]`。
- **OpenPcc 论文的直接判断**：密码学路线（HE/MPC）绕开了"信任分离"问题，但付出两处代价——数据非留存与用户匿名性变成事后补丁（协议保护 prompt 内容，不保护元数据与请求间状态），以及性能开销使其**无法进入生产部署路径** `[来源: https://arxiv.org/html/2606.11145v1]`。

---

## 4. 自托管开源方案

- **vLLM**：Apache-2.0，高吞吐 LLM 服务引擎 `[来源: https://github.com/vllm-project/vllm]`。**vLLM 本身不含 TEE 支持**；在 TEE 内跑 vLLM 需要外部框架（OpenPcc 的做法是在 Intel TDX VM + H100 CC 中运行 vLLM 0.8.5+）`[来源: https://arxiv.org/html/2606.11145v1]`。
- **OpenPcc**（2026，俄亥俄州立大学）：目前最接近"可自托管的全开源机密 LLM 推理"的方案——Intel TDX + NVIDIA H100、集成 CPU/GPU 复合远程证明、attestation-bound 会话、透明日志，在 Llama-3 8B + vLLM 上评测，声称自身在推理关键路径上引入的开销是**个位数百分比**，证明成本在生产级缓存 TTL 下摊薄到每请求几毫秒 `[来源: https://arxiv.org/html/2606.11145v1]`。论文许可为 CC BY-NC-ND 4.0（**注意：ND + NC，不能用于产品代码**）`[来源: https://arxiv.org/html/2606.11145v1]`。
- **Phala Cloud**：`docker-compose.yml` 直接部署为 Confidential VM，官方提供 GPU + vLLM 部署 skill `[来源: https://github.com/Phala-Network/phala-cloud]`。
- **Tinfoil**：安全关键基础设施开源、客户端 SDK 每次连接都做 enclave 度量校验 `[来源: https://docs.tinfoil.sh/verification/attestation-architecture]`；`tinfoil-js` 客户端支持 OpenAI API 格式 `[来源: https://github.com/tinfoilsh/tinfoil-js]`。
- **Ollama / llama.cpp**：可自托管但**无 TEE 集成**；若部署在用户自己的服务器上，则信任模型退化为"信任服务器管理员"。
- **Confidential Containers (CoCo) + Trustee**：Kubernetes 上的机密容器与证明/密钥分发组件，Trustee 为 Apache-2.0 `[来源: https://packages.fedoraproject.org/pkgs/trustee/trustee-kbs]` `[来源: https://confidentialcontainers.org/blog/2024/12/03/confidential-containers-without-confidential-hardware/]`。

---

## 5. 对 heyta 的判断（以下为分析，非检索事实）

1. **当前唯一生产可行的路径是"CPU TEE + 机密 GPU"**，且开销已经很低（H100 多数场景 <5%，B200 吞吐保留 >96%）`[来源: https://arxiv.org/html/2409.03992v2]` `[来源: https://developer.nvidia.com/blog/enabling-private-high-performance-production-ai-inference-with-nvidia-confidential-computing/]`。但对 heyta 而言，这要求用户自备 H100/H200 级机密 GPU 或购买 Azure/Phala/Tinfoil 的机密推理服务——成本与运维复杂度远超一个任务管理应用的合理范围。
2. **PCC 的架构思路（无状态、无特权访问、target diffusion、透明日志）值得借鉴，但不能照搬**：它依赖 Apple 自研硬件与 Apple 的证明 CA，第三方无法复现构建，也无法自托管 `[来源: https://arxiv.org/html/2606.11145v1]`。
3. **不要把 FHE/MPC 作为近期选项**：0.2 tokens/s 的 HE 推理与数秒级的 MPC 推理，对交互式任务助手不可接受 `[来源: https://arxiv.org/html/2606.11145v1]` `[来源: https://arxiv.org/abs/2211.01452]`。
4. **许可证红线**：Concrete ML 的"仅开发用途"许可 `[来源: https://github.com/zama-ai/concrete-ml]` 与 OpenPcc 论文的 CC BY-NC-ND `[来源: https://arxiv.org/html/2606.11145v1]` 都不符合 heyta 的依赖白名单（MIT/Apache/BSD/ISC/MPL）。可用的是 vLLM（Apache-2.0）、nvTrust（Apache-2.0）、Open Enclave（MIT）、Trustee（Apache-2.0）。
5. **最务实的中间路线**：heyta 的 E2EE 同步架构本身已经保证服务端看不到明文；若未来要加"云端 AI 助手"，应让**客户端在本地解密后调用 LLM**，或明确告知用户"该功能会把解密后的内容发送给 X 服务商"，而不是宣称服务端不可见。真正要上机密推理时，Phala/Tinfoil/Privatemode 这类现成托管服务比自建 TEE 栈更现实。
