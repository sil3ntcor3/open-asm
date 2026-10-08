package worker

import (
	"math/rand"
	"strconv"
	"strings"
)

// Edge detection for the port-scan stage.
//
// A SYN-ACK is evidence that something completed a handshake, not that a service
// is listening. CDN, WAF and load-balancer edges answer on ports nothing is
// bound to, which turns one host into hundreds of "services" that are all the
// same block page. In the enerbank.com run this produced 2461 asset_services
// across 431 distinct ports for what were, in reality, 3 edge IPs — and 2071 of
// the resulting HTTP probes returned the identical 403 body.
//
// The check asks the host about ports whose answer we already know. If it claims
// they are open, its port list carries no information and is discarded. Running
// this BEFORE the top-1000 sweep means a host that fails costs 5 packets instead
// of 1000, which also removes the scan burst that trips target-side detection.
//
// Two properties matter, and the first is easy to get wrong:
//
//  1. Control ports must come from the SAME population the real scan probes.
//     An edge answers what it is asked within the range it fronts, not literally
//     everything. Measured against ma.test.enerbank.com: ports 40193/49154/50002/
//     50300/50500 (in naabu's top-1000) answer consistently, while random ports
//     from 33000-64000 outside that list do not. Controls drawn from outside the
//     scanned set therefore come back closed on a host that is very obviously
//     tarpitting, and the check silently never fires.
//
//  2. Control ports must be ones a real host essentially never exposes. That is
//     what separates "this host answers everything" from "this host runs
//     services". The pool below is drawn from nmap's top-1000 but restricted to
//     legacy Windows RPC, obsolete middleware and internal-only management
//     ports. Verified discriminator: all five of 1029/1051/1067/2103/6510 answer
//     on the tarpitted host and none answer on www.cloudflare.com.
//
// This complements rather than replaces Core's open-port count guard: a count
// threshold is gameable by sitting under it (this WAF answered on 97 against a
// limit of 100) and cannot catch an edge that only answers on a handful of
// ports, while a control probe is independent of how many ports are claimed.
// Sizing note. An edge does not answer every port it is asked — it answers
// *probabilistically*, which is what a 5-port sample got wrong. Measured against
// hosts that slipped through a 5-port check and were then re-probed with 10
// fresh control ports: application-b99.demo.enerbank.com answered 5/10 and
// appintegration-legacy.integration.enerbank.com 3/10, so their per-port answer
// rate p sits around 0.3-0.5. With a >=2 threshold the probability of missing
// such a host is P(0 hits) + P(1 hit):
//
//	n=5   p=0.5 -> 18.8%      n=5   p=0.3 -> 52.8%
//	n=10  p=0.5 ->  1.1%      n=10  p=0.3 -> 14.9%
//	n=15  p=0.5 ->  0.05%     n=15  p=0.3 ->  3.5%
//
// The observed leak (2 of 5 hosts that passed) matched the n=5 prediction, so
// n=15 it is: ten extra packets against a 1000-port sweep, for roughly a 50x
// reduction in false negatives.
const (
	// Number of control ports probed before the real scan.
	naabuControlPortCount = 15

	// How many must answer before the host's port list is discarded. Requiring
	// two keeps a single legitimately-open oddity harmless, while a host
	// answering indiscriminately trips it with near-certainty.
	naabuEdgeConfirmThreshold = 2

	// Open-port count above which a *passing* host is re-verified before its
	// scan is trusted. A genuine internet-facing host exposes a handful of
	// ports; the hosts that leaked through the 5-port check reported 6 and 11.
	// Re-checking only above this bound keeps the cost off the common path,
	// where hosts return few ports and pay nothing.
	naabuRecheckPortCount = 10
)

// naabuControlPortPool holds ports that are inside naabu's top-1000 sweep but
// that an internet-facing host essentially never has open: legacy Windows
// dynamic RPC (1029-1078), obsolete middleware and licence managers, and
// management interfaces that are internal-only by design. An open port here is
// far better explained by "the host answers everything it is asked" than by a
// real service.
var naabuControlPortPool = []int{
	1029, 1033, 1035, 1036, 1037, 1038, 1039, 1040, 1041, 1044,
	1048, 1049, 1050, 1051, 1052, 1054, 1056, 1058, 1059, 1064,
	1065, 1066, 1067, 1069, 1071, 1074, 1174, 1175, 1192, 1199,
	1500, 1503, 1974, 1984, 2010, 2020, 2103, 2105, 2107, 2399,
	2701, 2809, 3737, 4003, 4006, 6510, 6779, 7019, 7025, 9011,
	10004, 10025, 16012, 16016, 18040,
}

// naabuControlPorts samples distinct ports from the control pool. Sampling per
// job rather than using a fixed set means a host cannot be tuned to answer
// correctly on one known probe.
func naabuControlPorts(count int) []int {
	return naabuControlPortsExcluding(count, nil)
}

// naabuControlPortsExcluding samples the control pool while skipping ports
// already used. The re-check draws from what the first pass did not touch, so it
// is independent evidence rather than a re-run of the probe that just missed.
func naabuControlPortsExcluding(count int, exclude []int) []int {
	if count <= 0 || len(naabuControlPortPool) == 0 {
		return nil
	}

	excluded := make(map[int]struct{}, len(exclude))
	for _, port := range exclude {
		excluded[port] = struct{}{}
	}

	pool := make([]int, 0, len(naabuControlPortPool))
	for _, port := range naabuControlPortPool {
		if _, skip := excluded[port]; !skip {
			pool = append(pool, port)
		}
	}
	if len(pool) == 0 {
		return nil
	}
	if count > len(pool) {
		count = len(pool)
	}

	rand.Shuffle(len(pool), func(i, j int) {
		pool[i], pool[j] = pool[j], pool[i]
	})
	return pool[:count]
}

// countOpenPorts counts the distinct ports a naabu sweep reported open. Used to
// decide whether a passing host's result is plausible enough to trust.
func countOpenPorts(stdout string) int {
	open := make(map[int]struct{})
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		idx := strings.LastIndex(line, ":")
		if idx < 0 {
			continue
		}
		port, err := strconv.Atoi(line[idx+1:])
		if err != nil {
			continue
		}
		open[port] = struct{}{}
	}
	return len(open)
}

// naabuControlInvocation builds the control probe. -p replaces -top-ports (naabu
// rejects both together), so this scans exactly the control set and nothing else.
func naabuControlInvocation(toolPath, target string, ports []int) toolInvocation {
	portList := make([]string, 0, len(ports))
	for _, port := range ports {
		portList = append(portList, strconv.Itoa(port))
	}
	return toolInvocation{
		executable: scannerExecutable(toolPath, "naabu"),
		args: []string{
			"-host", target, "-silent", "-p", strings.Join(portList, ","), "-rate", "150",
		},
	}
}

// countOpenControlPorts counts how many of the control ports the host reported
// open. naabu -silent emits one "host:port" line per open port; anything that is
// not one of the ports we asked about is ignored, so unrelated output cannot
// inflate the count.
func countOpenControlPorts(stdout string, controlPorts []int) int {
	if len(controlPorts) == 0 {
		return 0
	}

	control := make(map[int]struct{}, len(controlPorts))
	for _, port := range controlPorts {
		control[port] = struct{}{}
	}

	open := make(map[int]struct{}, len(controlPorts))
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		idx := strings.LastIndex(line, ":")
		if idx < 0 {
			continue
		}
		port, err := strconv.Atoi(line[idx+1:])
		if err != nil {
			continue
		}
		if _, isControl := control[port]; isControl {
			open[port] = struct{}{}
		}
	}
	return len(open)
}
