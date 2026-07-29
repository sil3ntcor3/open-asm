package worker

import (
	"fmt"
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
