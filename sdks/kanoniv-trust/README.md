# kanoniv-trust

Trust layer SDK and CLI for AI agents. Registry, delegation, provenance, reputation.

## Install

```bash
pip install kanoniv-trust
```

## CLI (`kt`)

```bash
kt agents                                          # List agents
kt register sdr-agent -c resolve,search            # Register agent
kt delegate coordinator sdr-agent -s resolve,merge  # Grant delegation
kt action sdr-agent resolve -m '{"entity":"john@acme.com"}'
kt memorize sdr-agent "Resolved john@acme.com"
kt log                                             # Provenance trail
kt demo                                            # Run live scenario
```

## Python SDK

```python
from kanoniv_trust import TrustClient

trust = TrustClient()  # defaults to https://trust.kanoniv.com

# Register agent
agent = trust.register("sdr-agent", capabilities=["resolve", "search"])

# Delegate
trust.delegate("coordinator", "sdr-agent", scopes=["resolve", "merge"])

# Record action
trust.action("sdr-agent", "resolve", metadata={"entity": "john@acme.com"})

# Save memory
trust.memorize("sdr-agent", "Resolved john@acme.com", entry_type="decision")

# Feedback (affects reputation)
trust.feedback(agent["did"], "resolve", "success", reward_signal=0.8)
```

## Observatory

Watch everything live at [trust.kanoniv.com](https://trust.kanoniv.com)
