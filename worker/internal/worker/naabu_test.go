package worker

import (
	"fmt"
	"math"
	"strings"
	"testing"
)

func TestNaabuControlPortsAreDistinctMembersOfThePool(t *testing.T) {
	pool := make(map[int]struct{}, len(naabuControlPortPool))
	for _, port := range naabuControlPortPool {
		pool[port] = struct{}{}
	}

	ports := naabuControlPorts(naabuControlPortCount)
	if len(ports) != naabuControlPortCount {
		t.Fatalf("naabuControlPorts returned %d ports, want %d", len(ports), naabuControlPortCount)
	}

	seen := make(map[int]struct{}, len(ports))
	for _, port := range ports {
		if _, inPool := pool[port]; !inPool {
			t.Fatalf("control port %d is not in the control pool", port)
		}
		if _, duplicate := seen[port]; duplicate {
			t.Fatalf("control port %d returned twice; duplicates weaken the threshold check", port)
		}
		seen[port] = struct{}{}
	}
}

// The control ports must sit inside the population the real scan probes.
// Drawing them from outside naabu's top-1000 was the original mistake: an edge
// answers what it is asked within the range it fronts, so out-of-range controls
// came back closed on a host that was very obviously tarpitting and the check
// never fired. Every pool member must therefore be a plausible top-1000 port.
func TestNaabuControlPoolStaysInsideTheScannedRange(t *testing.T) {
	if len(naabuControlPortPool) < naabuControlPortCount {
		t.Fatalf("control pool has %d ports, need at least %d to sample without repeats",
			len(naabuControlPortPool), naabuControlPortCount)
	}

	seen := make(map[int]struct{}, len(naabuControlPortPool))
	for _, port := range naabuControlPortPool {
		// nmap's top-1000 tops out at 65389 but is overwhelmingly low-numbered;
		// anything above 20000 here would repeat the out-of-range mistake for the
		// obscure-service ports this pool is built from.
		if port < 1024 || port > 20000 {
			t.Fatalf("control pool port %d is outside the range the top-1000 sweep meaningfully covers", port)
		}
		if _, duplicate := seen[port]; duplicate {
			t.Fatalf("control pool contains %d twice, which biases sampling", port)
		}
		seen[port] = struct{}{}
	}
}

func TestNaabuControlPortsAreRedrawnPerCall(t *testing.T) {
	// A fixed control set could be answered correctly by an edge that learns it.
	// Two draws matching exactly is possible but vanishingly unlikely; repeated
	// identical draws mean the source is not random at all.
	identical := 0
	for attempt := 0; attempt < 5; attempt++ {
		first := fmt.Sprint(naabuControlPorts(naabuControlPortCount))
		second := fmt.Sprint(naabuControlPorts(naabuControlPortCount))
		if first == second {
			identical++
		}
	}
	if identical == 5 {
		t.Fatal("naabuControlPorts returned the same set on every call, want per-call randomisation")
	}
}

func TestNaabuControlInvocationScansOnlyControlPorts(t *testing.T) {
	inv := naabuControlInvocation("/scanner-tools", "example.com", []int{40001, 50002})

	// -top-ports and -p are mutually exclusive in naabu; the control pass must
	// use -p so it probes exactly the control set and nothing else.
	if hasArgument(inv.args, "-top-ports") {
		t.Fatalf("control invocation args = %q, want no -top-ports", inv.args)
	}
	if got := argumentValue(t, inv.args, "-p"); got != "40001,50002" {
		t.Fatalf("control ports = %q, want %q", got, "40001,50002")
	}
	if got := argumentValue(t, inv.args, "-host"); got != "example.com" {
		t.Fatalf("control host = %q, want %q", got, "example.com")
	}
}

func TestCountOpenControlPortsCountsOnlyControlPorts(t *testing.T) {
	controlPorts := []int{40001, 40002, 40003}
	stdout := strings.Join([]string{
		"example.com:40001",
		"example.com:443", // real open port, not a control port
		"example.com:40003",
		"example.com:8080",
	}, "\n")

	if got := countOpenControlPorts(stdout, controlPorts); got != 2 {
		t.Fatalf("countOpenControlPorts = %d, want 2 (only control ports count)", got)
	}
}

func TestCountOpenControlPortsIgnoresDuplicates(t *testing.T) {
	// naabu can emit the same port for several resolved addresses of one host.
	// Counting those twice would trip the threshold on a single open port.
	controlPorts := []int{40001, 40002}
	stdout := "example.com:40001\nexample.com:40001\n"

	if got := countOpenControlPorts(stdout, controlPorts); got != 1 {
		t.Fatalf("countOpenControlPorts = %d, want 1 for a repeated port", got)
	}
}

func TestCountOpenControlPortsHandlesEmptyAndMalformedOutput(t *testing.T) {
	controlPorts := []int{40001}

	if got := countOpenControlPorts("", controlPorts); got != 0 {
		t.Fatalf("countOpenControlPorts(empty) = %d, want 0", got)
	}
	if got := countOpenControlPorts("not-a-result\nexample.com:notaport\n", controlPorts); got != 0 {
		t.Fatalf("countOpenControlPorts(malformed) = %d, want 0", got)
	}
}

// An edge answers control ports probabilistically, so the sample has to be big
// enough that a >=2 threshold is not defeated by luck. At the measured answer
// rate (3/10 and 5/10 on hosts that leaked through a 5-port check) a 5-port
// sample misses 19-47% of edges; 15 brings that under 4%.
func TestNaabuControlSampleIsLargeEnoughToSurviveAProbabilisticEdge(t *testing.T) {
	const measuredWorstCaseAnswerRate = 0.3
	const maxAcceptableMissRate = 0.05

	missRate := probabilityOfFewerThan(
		naabuEdgeConfirmThreshold,
		naabuControlPortCount,
		measuredWorstCaseAnswerRate,
	)
	if missRate > maxAcceptableMissRate {
		t.Fatalf("with %d control ports and threshold %d, an edge answering %.0f%% of ports is missed %.1f%% of the time; want <= %.0f%%",
			naabuControlPortCount, naabuEdgeConfirmThreshold,
			measuredWorstCaseAnswerRate*100, missRate*100, maxAcceptableMissRate*100)
	}
}

// probabilityOfFewerThan returns P(X < k) for X ~ Binomial(n, p).
func probabilityOfFewerThan(k, n int, p float64) float64 {
	total := 0.0
	for i := 0; i < k; i++ {
		total += float64(binomial(n, i)) * math.Pow(p, float64(i)) *
			math.Pow(1-p, float64(n-i))
	}
	return total
}

func binomial(n, k int) int {
	result := 1
	for i := 0; i < k; i++ {
		result = result * (n - i) / (i + 1)
	}
	return result
}

func TestNaabuControlPoolSupportsTwoNonOverlappingSamples(t *testing.T) {
	// The re-check draws from ports the first pass did not use, so the pool has
	// to hold two full samples with room to spare.
	if len(naabuControlPortPool) < naabuControlPortCount*2 {
		t.Fatalf("control pool has %d ports; two non-overlapping samples of %d need at least %d",
			len(naabuControlPortPool), naabuControlPortCount, naabuControlPortCount*2)
	}
}

func TestNaabuControlPortsExcludingSkipsAlreadyProbedPorts(t *testing.T) {
	first := naabuControlPorts(naabuControlPortCount)
	second := naabuControlPortsExcluding(naabuControlPortCount, first)

	if len(second) != naabuControlPortCount {
		t.Fatalf("re-check sample has %d ports, want %d", len(second), naabuControlPortCount)
	}

	used := make(map[int]struct{}, len(first))
	for _, port := range first {
		used[port] = struct{}{}
	}
	for _, port := range second {
		if _, reused := used[port]; reused {
			t.Fatalf("re-check reused port %d from the first pass; it must be independent evidence", port)
		}
	}
}

func TestCountOpenPortsCountsDistinctPorts(t *testing.T) {
	stdout := strings.Join([]string{
		"example.com:80",
		"example.com:443",
		"example.com:443", // repeated for a second resolved address
		"garbage",
	}, "\n")

	if got := countOpenPorts(stdout); got != 2 {
		t.Fatalf("countOpenPorts = %d, want 2", got)
	}
	if got := countOpenPorts(""); got != 0 {
		t.Fatalf("countOpenPorts(empty) = %d, want 0", got)
	}
}

func TestRecheckThresholdIsAbovePlausibleHostPortCounts(t *testing.T) {
	// The re-check must not fire for ordinary hosts — a web server with
	// http/https/ssh/mail sits well under this — while still catching the
	// 6- and 11-port phantom lists that leaked through the first gate.
	if naabuRecheckPortCount < 5 {
		t.Fatalf("naabuRecheckPortCount = %d is low enough to re-probe ordinary hosts", naabuRecheckPortCount)
	}
	if naabuRecheckPortCount > 20 {
		t.Fatalf("naabuRecheckPortCount = %d is too permissive to catch phantom port lists", naabuRecheckPortCount)
	}
}

func TestEdgeConfirmThresholdToleratesOneLegitimateOpenPort(t *testing.T) {
	// A host with a single genuinely-open high port must NOT have its scan
	// discarded — that would lose real discovery to a false positive.
	if naabuEdgeConfirmThreshold < 2 {
		t.Fatalf("naabuEdgeConfirmThreshold = %d, want >= 2 so one open control port cannot discard a real scan",
			naabuEdgeConfirmThreshold)
	}
	if naabuEdgeConfirmThreshold > naabuControlPortCount {
		t.Fatalf("naabuEdgeConfirmThreshold = %d exceeds control port count %d; the check could never fire",
			naabuEdgeConfirmThreshold, naabuControlPortCount)
	}
}
