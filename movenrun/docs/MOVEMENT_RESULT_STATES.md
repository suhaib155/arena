# Movement result states

GPS acquisition happens before an active session exists. The screen shows
Finding GPS during acquisition. Permission denial, disabled services, acquisition
timeout and tracker failure return to a recoverable Session not started screen.
Retry creates a fresh tracker attempt; Back cancels the pending subscription;
Settings is available for permission/services failures. Pause and Finish are
available only in active or paused capture states.

A runtime tracker error preserves the workout and records missing continuity.
Time continues, while unavailable geometry contributes no joining segment.
Finishing records the interruption in the summary. No capacity limit pauses or
finishes a workout.

The mobile network decoder accepts three server seal states: unknown (null or
the complete absence of older fields), evaluated open (false, empty methods,
zero count), and evaluated sealed (true, supported unique methods, positive
count). Partial, contradictory and unsupported field combinations fail closed.
The common submission pipeline carries this result through direct submission
and retries. Persisted verification summaries keep seal scalars/method names,
never precise crossing geometry.

Summary subscribes to verification changes so delayed responses can update its
server status. Recording a server seal result has no capture, defence or reward
side effects. Existing local progression remains explicitly local. Unsaved or
ineligible movement is displayed as traversed only; sharing an unsaved summary
does not call it saved. The former fabricated captured-territory illustration
is removed. Actual geographic map/share rendering remains a separate task.

Implementation checkpoint: validation is deferred at the user's request. New
decoder tests passed before that change in workflow; component rendering,
recovery scenarios, final combined suites and physical Android checks remain
open. This document is not a runtime acceptance claim.
