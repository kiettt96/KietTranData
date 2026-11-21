// Trạng thái dựng sẵn cho ca M6 (vòng 2): Core và reviewPrints chép từ luồng của mục tiêu mẫu sau một lượt duyệt CHƯA ĐẠT, một lượt ĐẠT và hai
// lần chặn; bản ghi cổng đóng dựng tay theo dạng của hooks/lib/closing-state.ts. Dữ liệu là của mục tiêu mẫu, không có nội dung thật.

export const M6_STATE: Record<string, unknown> = {
 "core": {
  "brief": {
   "goalId": 1,
   "goal": "Sửa thống kê",
   "requirementsBase": 0,
   "steps": [
    "Việc 1: tách hàm",
    "Việc 2: thêm cờ",
    "Việc 3: báo cáo"
   ],
   "tasks": [],
   "constraints": [],
   "constraintsBase": 0,
   "quality": [],
   "depth": "substantial",
   "volume": "medium",
   "kind": "edit",
   "tier": "complex",
   "main": {
    "family": "sonnet",
    "effort": "medium"
   },
   "mainBase": {
    "family": "sonnet",
    "effort": "medium"
   },
   "why": "việc vừa",
   "relation": "new",
   "source": "router",
   "isFollowUp": false,
   "isReference": false,
   "scopePaths": [
    "/repo"
   ],
   "prompt": "Sửa thống kê",
   "at": 1000
  },
  "plan": [
   {
    "id": 1,
    "title": "Việc 1: tách hàm",
    "status": "verified",
    "check": "`bash tests/kiem.sh`",
    "closedSeq": 1,
    "auto": true,
    "byCheck": true,
    "note": "tự động: bash tests/kiem.sh chạy đạt sau thay đổi cuối"
   },
   {
    "id": 2,
    "title": "Việc 2: thêm cờ",
    "status": "done",
    "closedSeq": 2
   },
   {
    "id": 3,
    "title": "Việc 3: báo cáo",
    "status": "done",
    "closedSeq": 3
   }
  ],
  "route": {
   "family": "sonnet",
   "effort": "medium",
   "tier": "complex",
   "goalId": 1,
   "reason": "turn đầu tiên của phiên"
  },
  "warnings": [],
  "log": [
   {
    "at": 1000,
    "where": "main",
    "label": "turn",
    "family": "sonnet",
    "effort": "medium",
    "reason": "turn đầu tiên của phiên",
    "isApplied": true
   },
   {
    "at": 1000,
    "where": "agent",
    "label": "Kiểm độc lập: thống kê",
    "family": "opus",
    "effort": "high",
    "agentId": "a-u1",
    "usd": 0.00024,
    "measured": true,
    "reason": "vai review theo tiền tố: model mặc định của vai",
    "isApplied": true
   },
   {
    "at": 1000,
    "where": "agent",
    "label": "Kiểm độc lập: thống kê",
    "family": "opus",
    "effort": "high",
    "agentId": "a-u2",
    "usd": 0.00024,
    "measured": true,
    "reason": "vai review theo tiền tố: model mặc định của vai",
    "isApplied": true
   }
  ],
  "ledger": {
   "session": {
    "main": {
     "calls": 0,
     "input": 0,
     "output": 0,
     "cacheRead": 0,
     "cacheWrite": 0,
     "usd": 0
    },
    "agent": {
     "calls": 2,
     "input": 20,
     "output": 20,
     "cacheRead": 0,
     "cacheWrite": 0,
     "usd": 0.00048
    },
    "analyzer": {
     "calls": 1,
     "input": 1000,
     "output": 500,
     "cacheRead": 0,
     "cacheWrite": 0,
     "usd": 0.007
    }
   },
   "goal": {
    "goalId": 1,
    "buckets": {
     "main": {
      "calls": 0,
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0,
      "usd": 0
     },
     "agent": {
      "calls": 2,
      "input": 20,
      "output": 20,
      "cacheRead": 0,
      "cacheWrite": 0,
      "usd": 0.00048
     },
     "analyzer": {
      "calls": 1,
      "input": 1000,
      "output": 500,
      "cacheRead": 0,
      "cacheWrite": 0,
      "usd": 0.007
     }
    },
    "spawned": 2,
    "fanoutWarned": false,
    "unplanned": 2
   },
   "calib": {
    "haiku": 1,
    "sonnet": 1,
    "opus": 0.6412000000000001,
    "fable": 1
   },
   "samples": 2,
   "baseline": {
    "turn": "t1",
    "family": "sonnet",
    "effort": "medium",
    "served": {
     "family": "sonnet",
     "effort": "medium"
    },
    "rewrite": 0,
    "pure": {
     "session": 0.00024,
     "goal": 0.00024
    },
    "covered": {
     "session": 0.00048,
     "goal": 0.00048
    }
   },
   "shapes": {
    "light/small/investigate": {
     "samples": 2,
     "output": 6.666666666666667
    }
   }
  },
  "lift": {
   "depth": 0,
   "effort": 0
  },
  "lastTurnAt": 0,
  "lastContext": 0,
  "sysTokens": 0,
  "archived": [],
  "delegations": {
   "goalId": 1,
   "items": []
  },
  "mirror": {
   "goalId": 1,
   "steps": []
  },
  "agentProgress": {
   "goalId": 1,
   "items": [
    {
     "agentId": "a-u1",
     "title": "Kiểm độc lập: thống kê",
     "family": "opus",
     "effort": "high",
     "state": "done",
     "tools": 0,
     "startedAt": 1000,
     "steps": [],
     "endedAt": 1000
    },
    {
     "agentId": "a-u2",
     "title": "Kiểm độc lập: thống kê",
     "family": "opus",
     "effort": "high",
     "state": "done",
     "tools": 0,
     "startedAt": 1000,
     "steps": [],
     "endedAt": 1000
    }
   ],
   "tally": [
    {
     "key": "own-kiểm độc lập: thống kê",
     "title": "Kiểm độc lập: thống kê",
     "spawned": 2,
     "done": 2,
     "failed": 0,
     "running": 0
    }
   ],
   "open": {}
  },
  "activity": {
   "goalId": 1,
   "changes": 2
  },
  "routerFail": null,
  "checkHint": null,
  "turnFault": null,
  "closing": {
   "seq": 3,
   "goalId": -1,
   "lastPassSeq": null
  },
  "toasted": {
   "goalId": -1,
   "keys": []
  },
  "stopNudged": -1,
  "reqNoticed": -1,
  "missingNoticed": {
   "goalId": -1,
   "key": ""
  },
  "retry": {
   "goalId": -1,
   "items": []
  },
  "waivers": {
   "goalId": -1,
   "items": []
  },
  "noCheckNudged": -1,
  "team": {
   "goalId": 1,
   "cause": "depth",
   "steps": [
    {
     "name": "check",
     "state": "pass"
    },
    {
     "name": "review",
     "state": "pass"
    }
   ]
  },
  "forks": {
   "goalId": -1,
   "parts": [],
   "merged": [],
   "off": "none"
  },
  "approval": {
   "goalId": -1,
   "status": "none",
   "rounds": 0,
   "asked": false,
   "awaitingAnswer": false
  },
  "skill": {
   "goalId": -1,
   "seq": 0,
   "lastWrite": -1,
   "trialAt": -1,
   "path": ""
  },
  "skillNudged": -1,
  "changed": {
   "goalId": 1,
   "paths": [
    "thong-ke.sh"
   ],
   "unknown": 1,
   "overflow": 0
  },
  "changedNoticed": 1,
  "fable": {
   "failures": 0,
   "pauseLeft": 0,
   "ready": null,
   "reason": "",
   "holdKey": "",
   "briefedGoal": -1,
   "promptPaused": false
  },
  "fallback": {
   "failures": 0,
   "pauseLeft": 0,
   "promptPaused": false,
   "active": null,
   "briefedFamily": null
  },
  "goalTurns": {
   "goalId": -1,
   "done": 0,
   "interrupted": false
  },
  "conduct": {
   "goalId": -1,
   "solo": false,
   "agentDenied": false,
   "deniedWrites": 0,
   "deniedChecks": 0,
   "selfWrites": 0,
   "selfChecks": 0,
   "reads": 0,
   "readNoted": 0
  }
 },
 "reviewPrints": {
  "goalId": 1,
  "spawn": {
   "a-u1": null,
   "a-u2": null
  },
  "done": {
   "a-u1": null,
   "a-u2": null
  },
  "stale": [],
  "spawnSeq": {
   "a-u1": 4,
   "a-u2": 5
  },
  "staleFiles": []
 },
 "closing": {
  "verdicts": {
   "goalId": 1,
   "items": [
    {
     "agentId": "a-u1",
     "role": "review",
     "verdict": "fail",
     "isClean": true,
     "isReview": true,
     "seq": 4.5,
     "family": "opus",
     "description": "Kiểm độc lập: thống kê"
    },
    {
     "agentId": "a-u2",
     "role": "review",
     "verdict": "pass",
     "isClean": true,
     "isReview": true,
     "seq": 5.5,
     "family": "opus",
     "description": "Kiểm độc lập: thống kê"
    }
   ]
  },
  "stepRuns": {
   "goalId": 1,
   "runs": [
    {
     "keys": [
      "bash tests/kiem.sh"
     ],
     "output": "ĐẠT 5/5",
     "passed": true,
     "seq": 3
    }
   ],
   "checkSeq": []
  },
  "pipeNotes": {
   "goalId": -1,
   "n": 0,
   "last": null
  },
  "closingState": {
   "goalId": 1,
   "blocks": 2,
   "key": "review:fail:2:-1::0:"
  },
  "rounds": []
 }
}
