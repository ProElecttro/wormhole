package guardiand

import (
	"context"
	"testing"
	"time"

	"github.com/certusone/wormhole/node/pkg/p2p"
	"github.com/certusone/wormhole/node/pkg/supervisor"

	gossipv1 "github.com/certusone/wormhole/node/pkg/proto/gossip/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wormhole-foundation/wormhole/sdk/vaa"
	"go.uber.org/zap"
)

type reobservationTestContext struct {
	context.Context
	obsvReqC      chan *gossipv1.ObservationRequest
	chainObsvReqC map[vaa.ChainID]chan *gossipv1.ObservationRequest
}

type gossipMock struct {
}

func (g gossipMock) Subscribe(ctx context.Context, ch chan<- *p2p.GossipEnvelope) error {
	return nil
}

func setUpReobservationTest() (reobservationTestContext, func()) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)

	obsvReqC := make(chan *gossipv1.ObservationRequest)

	chainObsvReqC := make(map[vaa.ChainID]chan *gossipv1.ObservationRequest)
	for i := 0; i < 10; i++ {
		chainObsvReqC[vaa.ChainID(i)] = make(chan *gossipv1.ObservationRequest, 1)
	}

	supervisor.New(context.Background(), zap.L(), func(ctx context.Context) error {
		err := supervisor.Run(ctx, "reobserve", reobservationRequestsHandler(nil, &gossipMock{}, chainObsvReqC, obsvReqC))
		if err != nil {
			return err
		}
		supervisor.Signal(ctx, supervisor.SignalHealthy)
		supervisor.Signal(ctx, supervisor.SignalDone)

		return nil
	})

	tc := reobservationTestContext{
		Context:       ctx,
		obsvReqC:      obsvReqC,
		chainObsvReqC: chainObsvReqC,
	}
	return tc, cancel
}

func readFromChannel(parent context.Context, c <-chan *gossipv1.ObservationRequest) (*gossipv1.ObservationRequest, bool) {
	ctx, cancel := context.WithTimeout(parent, 50*time.Millisecond)
	defer cancel()

	select {
	case <-ctx.Done():
		return nil, false
	case r := <-c:
		return r, true
	}
}

func TestReobservationRequest(t *testing.T) {
	ctx, cancel := setUpReobservationTest()
	defer cancel()

	req := &gossipv1.ObservationRequest{
		ChainId: 1,
		TxHash:  []byte{0xe5, 0x9c, 0x1b, 0xe5, 0x0b, 0xe7, 0xe4, 0x7e},
	}

	ctx.obsvReqC <- req

	actual, ok := readFromChannel(ctx, ctx.chainObsvReqC[vaa.ChainID(req.ChainId)])
	require.True(t, ok)

	assert.Equal(t, req, actual)
}

func TestDuplicateReobservation(t *testing.T) {
	ctx, cancel := setUpReobservationTest()
	defer cancel()

	req := &gossipv1.ObservationRequest{
		ChainId: 1,
		TxHash:  []byte{0xe5, 0x9c, 0x1b, 0xe5, 0x0b, 0xe7, 0xe4, 0x7e},
	}

	ctx.obsvReqC <- req

	actual, ok := readFromChannel(ctx, ctx.chainObsvReqC[vaa.ChainID(req.ChainId)])
	require.True(t, ok)
	assert.Equal(t, req, actual)

	// Receiving the same request again should not trigger another re-observation.
	ctx.obsvReqC <- req

	_, ok = readFromChannel(ctx, ctx.chainObsvReqC[vaa.ChainID(req.ChainId)])
	assert.False(t, ok)
}

func TestMultipleReobservations(t *testing.T) {
	ctx, cancel := setUpReobservationTest()
	defer cancel()

	req := &gossipv1.ObservationRequest{
		ChainId: 1,
		TxHash:  []byte{0xe5, 0x9c, 0x1b, 0xe5, 0x0b, 0xe7, 0xe4, 0x7e},
	}

	ctx.obsvReqC <- req

	actual, ok := readFromChannel(ctx, ctx.chainObsvReqC[vaa.ChainID(req.ChainId)])
	require.True(t, ok)
	assert.Equal(t, req, actual)

	// Send a request for the same chain id but different tx hash.
	req.TxHash = []byte{0x6e, 0xf0, 0xa6, 0xba, 0x47, 0x3d, 0x34, 0x51}

	ctx.obsvReqC <- req

	actual, ok = readFromChannel(ctx, ctx.chainObsvReqC[vaa.ChainID(req.ChainId)])
	require.True(t, ok)
	assert.Equal(t, req, actual)

	// Send a request for the same tx hash but different chain id.
	req.ChainId = 3
	ctx.obsvReqC <- req

	actual, ok = readFromChannel(ctx, ctx.chainObsvReqC[vaa.ChainID(req.ChainId)])
	require.True(t, ok)
	assert.Equal(t, req, actual)
}

func TestReobserveUnknownChainId(t *testing.T) {
	ctx, cancel := setUpReobservationTest()
	defer cancel()

	req := &gossipv1.ObservationRequest{
		ChainId: uint32(len(ctx.chainObsvReqC)) + 1,
		TxHash:  []byte{0xe5, 0x9c, 0x1b, 0xe5, 0x0b, 0xe7, 0xe4, 0x7e},
	}

	ctx.obsvReqC <- req

	_, ok := readFromChannel(ctx, ctx.chainObsvReqC[vaa.ChainID(req.ChainId)])
	assert.False(t, ok)
}

func TestBlockingSend(t *testing.T) {
	ctx, cancel := setUpReobservationTest()
	defer cancel()

	req := &gossipv1.ObservationRequest{
		ChainId: 1,
		TxHash:  []byte{0xe5, 0x9c, 0x1b, 0xe5, 0x0b, 0xe7, 0xe4, 0x7e},
	}

	// Send one reobservation request but don't drain it from the chain-specific channel.
	ctx.obsvReqC <- req

	// Now send another request for the same chain id but different tx hash.  This should get dropped.
	req2 := &gossipv1.ObservationRequest{
		ChainId: 1,
		TxHash:  []byte{0x96, 0xe3, 0x94, 0xec, 0x5a, 0x00, 0xfc, 0x8b},
	}
	ctx.obsvReqC <- req2

	// This is a bit awkward but we need to wait until the goroutine handling the requests has finished
	// processing the second request.  If we read from the channel too quickly then we might pop out the
	// first request too early, unblocking the channel.  Unfortunately there's no easy way for us to detect
	// when the handler is done without adding unnecessary complexity.
	time.Sleep(50 * time.Millisecond)

	actual, ok := readFromChannel(ctx, ctx.chainObsvReqC[vaa.ChainID(req.ChainId)])
	assert.True(t, ok)
	assert.Equal(t, req, actual)

	_, ok = readFromChannel(ctx, ctx.chainObsvReqC[vaa.ChainID(req2.ChainId)])
	assert.False(t, ok)
}
